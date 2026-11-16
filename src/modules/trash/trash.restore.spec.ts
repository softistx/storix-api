import { describe, expect, test } from "bun:test";
import { fileReader } from "@/modules/files/public";
import { filesWorld } from "../../../test/files.harness";
import { codeOf, trashArea } from "../../../test/trash.harness";

const files = filesWorld();

describe("restoreNodes", () => {
  test("brings a folder back with the subtree that went with it", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const file = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    await a.trash([docs]);
    const result = await a.restore([docs]);
    expect(result.errors).toBeUndefined();
    const [back] = (result.data?.["restoreNodes"] ?? []) as {
      id: string;
      parentId: string;
      trashedAt: string | null;
    }[];
    expect(back?.parentId).toBe(a.root.id);
    expect(back?.trashedAt).toBeNull();
    expect(await a.children(a.root.id)).toEqual(["docs"]);
    expect(await a.children(docs.id)).toEqual(["a.txt"]);
    expect(await a.trashed()).toEqual([]);
    const reader = { key: file.key, accountId: a.owner.principal.accountId };
    expect(await fileReader(a.mongo, reader)).toBe(true);
    expect(await a.usage()).toMatchObject({
      bytes: 5,
      files: 1,
      trashBytes: 0,
    });
  });

  test("a restore leaves what was trashed earlier in the trash", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const old = await files.addFile(a.owner, a.id, docs.id, "old.txt", "old");
    await files.addFile(a.owner, a.id, docs.id, "new.txt", "new");
    await a.trash([old]);
    await a.trash([docs]);
    await a.restore([docs]);
    expect(await a.children(docs.id)).toEqual(["new.txt"]);
    expect((await a.trashed()).map((n) => n.name)).toEqual(["old.txt"]);
  });

  test("a gone parent sends the node to the root", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const file = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    await a.trash([file]);
    await a.trash([docs]);
    const result = await a.restore([file]);
    const [back] = (result.data?.["restoreNodes"] ?? []) as {
      parentId: string;
      ancestors: string[];
    }[];
    expect(back?.parentId).toBe(a.root.id);
    expect(back?.ancestors).toEqual([a.root.id]);
    expect(await a.children(a.root.id)).toEqual(["a.txt"]);
  });

  test("a name a live sibling holds is suffixed, never refused", async () => {
    const a = await trashArea(files);
    const first = await files.addFile(a.owner, a.id, a.root.id, "a.txt", "one");
    await a.trash([first]);
    await files.addFile(a.owner, a.id, a.root.id, "a.txt", "two");
    const result = await a.restore([first]);
    expect(result.errors).toBeUndefined();
    expect(await a.children(a.root.id)).toEqual(["a (1).txt", "a.txt"]);
  });

  test("a live node is not-trashed, a node that went with a folder is a 404", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const file = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    expect(codeOf(await a.restore([file]))).toBe("trash.errors.not-trashed");
    await a.trash([docs]);
    expect(codeOf(await a.restore([file]))).toBe("nodes.errors.not-found");
    expect(await a.trashed()).toHaveLength(1);
  });

  test("the trash lists newest first and pages by cursor", async () => {
    const a = await trashArea(files);
    const made = [];
    for (const name of ["a", "b", "c"]) {
      made.push(await a.folder(a.root.id, name));
    }
    for (const folder of made) await a.trash([folder]);
    const first = await a.list({ first: 2 });
    expect(first.nodes.map((n) => n.name)).toEqual(["c", "b"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = await a.list({ first: 2, after: first.pageInfo.endCursor });
    expect(next.nodes.map((n) => n.name)).toEqual(["a"]);
    expect(next.pageInfo.hasNextPage).toBe(false);
  });
});
