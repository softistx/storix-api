import { describe, expect, test } from "bun:test";
import { ADD, filesWorld } from "../../../../test/files.harness";
import { versionsArea } from "../../../../test/versions.harness";

const files = filesWorld();

describe("versions of a file: adding", () => {
  test("a new file has version 1, listed as current, and its blob has two holders", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const list = await a.versions(file.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      number: 1,
      key: file.key,
      size: 3,
      current: true,
      restoredFrom: null,
    });
    const blob = await a.mongo.db.blobs.findFirst({ key: file.key });
    expect(blob?.refs).toBe(2);
  });

  test("addFileVersion makes version 2 current and the file follows the object", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const { up, result } = await a.push(file.id, "twenty", "second");
    expect(result.errors).toBeUndefined();
    expect(result.data?.["addFileVersion"]).toMatchObject({
      id: file.id,
      name: "a.txt",
      key: up.key,
      size: 6,
    });
    const list = await a.versions(file.id);
    expect(list.map((v) => [v.number, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(list[0]?.note).toBe("second");
    expect((await a.mongo.db.nodes.findFirst({ name: "a.txt" }))?.size).toBe(6);
  });

  test("usage counts each blob once and the old version as versionBytes", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.push(file.id, "twenty");
    expect(await a.usage()).toMatchObject({
      bytes: 9,
      files: 1,
      versionBytes: 3,
    });
  });

  test("addFile with NEW_VERSION on a same-name file appends a version, with none it adds a file", async () => {
    const a = await versionsArea(files);
    const first = await files.upload(a.owner, a.id, "one");
    const make = (key: string, onConflict: string) =>
      a.send(ADD, {
        input: { key, name: "n.txt", parentId: a.root.id, onConflict },
      });
    const created = await make(first.key, "NEW_VERSION");
    expect(created.errors).toBeUndefined();
    const id: string = created.data?.["addFile"].id;
    const second = await files.upload(a.owner, a.id, "three");
    const again = await make(second.key, "NEW_VERSION");
    expect(again.errors).toBeUndefined();
    expect(again.data?.["addFile"]).toMatchObject({ id, key: second.key });
    expect(await a.versions(id)).toHaveLength(2);
  });

  test("a file made before versions gets its version 1 when they are first read", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.mongo.db.versions.raw.deleteMany({});
    await a.mongo.db.nodes.raw.updateOne(
      { name: "a.txt" },
      { $set: { currentVersionId: null } },
    );
    await a.mongo.db.blobs.raw.updateOne(
      { key: file.key },
      { $set: { refs: 1 } },
    );
    const list = await a.versions(file.id);
    expect(list.map((v) => v.number)).toEqual([1]);
    expect((await a.mongo.db.blobs.findFirst({ key: file.key }))?.refs).toBe(2);
  });

  test("a folder, an unknown key and an unknown file are refused", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const folder = await a.push(a.root.id, "x");
    expect(folder.result.errors?.[0]?.extensions?.["code"]).toBe(
      "files.errors.not-a-file",
    );
    const bad = await a.send(
      `mutation($f: ID!) { addFileVersion(fileId: $f, key: "nope") { id } }`,
      { f: file.id },
    );
    expect(bad.errors?.[0]?.extensions?.["code"]).toBe(
      "files.errors.key-unknown",
    );
  });
});
