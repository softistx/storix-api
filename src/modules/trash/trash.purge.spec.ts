import { describe, expect, test } from "bun:test";
import { reconcileUsage } from "@/modules/quotas/public";
import { filesWorld } from "../../../test/files.harness";
import { codeOf, trashArea } from "../../../test/trash.harness";

const files = filesWorld();

type Area = Awaited<ReturnType<typeof trashArea>>;

// What `quota:reconcile` would find: no drift between the counters and a
// recount of the stored rows.
async function agrees(a: Area) {
  const report = await reconcileUsage(a.mongo, a.core(), a.id);
  expect(report.drift).toBe(false);
  return report.after;
}

describe("trash accounting", () => {
  test("trashing moves the bytes from the files to the trash", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    expect(await a.usage()).toMatchObject({
      bytes: 5,
      files: 1,
      trashBytes: 0,
    });
    await a.trash([file]);
    expect(await a.usage()).toMatchObject({
      bytes: 5,
      files: 0,
      trashBytes: 5,
    });
    expect(await agrees(a)).toMatchObject({
      bytes: 5,
      files: 0,
      trashBytes: 5,
    });
  });

  test("a blob a live copy still holds is not the trash's", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    const copied = await a.send(
      `mutation($ids: [ID!]!, $parentId: ID!) { copyNodes(ids: $ids, parentId: $parentId) { id } }`,
      { ids: [file.id], parentId: a.root.id },
    );
    expect(copied.errors).toBeUndefined();
    await a.trash([file]);
    expect(await a.usage()).toMatchObject({
      bytes: 5,
      files: 1,
      trashBytes: 0,
    });
    await agrees(a);
  });
});

describe("purgeNodes", () => {
  test("releases the blobs and the quota, versions included", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const file = await files.addFile(a.owner, a.id, docs.id, "a.txt", "v1");
    const { up } = await a.push(file.id, "version two");
    await a.trash([docs]);
    expect(await a.usage()).toMatchObject({
      bytes: 13,
      files: 0,
      versionBytes: 2,
      trashBytes: 11,
    });
    const result = await a.purge([docs]);
    expect(result.errors).toBeUndefined();
    expect(result.data?.["purgeNodes"]).toBe(2);
    expect(await a.mongo.db.nodes.findFirst({ name: "a.txt" })).toBeUndefined();
    expect(await a.mongo.db.versions.findMany({ filter: {} })).toEqual([]);
    for (const key of [file.key, up.key]) {
      const blob = await a.mongo.db.blobs.findFirst({ key });
      expect(blob?.refs).toBe(0);
      expect(blob?.releasedAt).toBeInstanceOf(Date);
    }
    expect(await a.usage()).toEqual({
      bytes: 0,
      files: 0,
      versionBytes: 0,
      trashBytes: 0,
    });
    expect(await agrees(a)).toEqual({
      bytes: 0,
      files: 0,
      versionBytes: 0,
      trashBytes: 0,
    });
  });

  test("a blob another file keeps stays held and counted", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    await a.send(
      `mutation($ids: [ID!]!, $parentId: ID!) { copyNodes(ids: $ids, parentId: $parentId) { id } }`,
      { ids: [file.id], parentId: a.root.id },
    );
    await a.trash([file]);
    await a.purge([file]);
    const blob = await a.mongo.db.blobs.findFirst({ key: file.key });
    expect(blob?.refs).toBe(1);
    expect(await a.usage()).toMatchObject({
      bytes: 5,
      files: 1,
      trashBytes: 0,
    });
    await agrees(a);
  });

  test("a live node is not-trashed, and a refused id purges nothing", async () => {
    const a = await trashArea(files);
    const gone = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    const live = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "b.txt",
      "bravo",
    );
    await a.trash([gone]);
    expect(codeOf(await a.purge([gone, live]))).toBe(
      "trash.errors.not-trashed",
    );
    expect(await a.trashed()).toHaveLength(1);
  });

  test("emptyTrash purges every entry and frees the quota", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const inner = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    const loose = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "b.txt",
      "bravo",
    );
    await a.trash([inner]);
    await a.trash([docs, loose]);
    const result = await a.empty();
    expect(result.data?.["emptyTrash"]).toBe(3);
    expect(await a.trashed()).toEqual([]);
    expect(await a.usage()).toMatchObject({ bytes: 0, trashBytes: 0 });
    await agrees(a);
  });
});
