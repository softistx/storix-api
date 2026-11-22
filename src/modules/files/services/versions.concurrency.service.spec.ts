import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import { ADD_VERSION, versionsArea } from "../../../../test/versions.harness";

const files = filesWorld();

describe("version numbers under concurrency", () => {
  test("parallel addFileVersion calls give contiguous, unique numbers", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const ups = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        files.upload(a.owner, a.id, `body-${i}`),
      ),
    );
    const results = await Promise.all(
      ups.map((up) => a.send(ADD_VERSION, { fileId: file.id, key: up.key })),
    );
    for (const result of results) expect(result.errors).toBeUndefined();
    const numbers = (await a.versions(file.id)).map((v) => v.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const rows = await a.mongo.db.versions.raw
      .find({}, { projection: { number: 1, blobKey: 1 } })
      .toArray();
    expect(new Set(rows.map((r) => r["number"])).size).toBe(9);
    const node = await a.mongo.db.nodes.findFirst({ name: "a.txt" });
    const current = await a.mongo.db.versions.findFirst({
      _id: node?.currentVersionId as never,
    });
    expect(current?.number).toBe(9);
  });

  test("the unique index refuses a repeated number for a file", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const row = await a.mongo.db.versions.raw.findOne({});
    expect(file.id).toBeDefined();
    await expect(
      a.mongo.db.versions.raw.insertOne({ ...row, _id: undefined } as never),
    ).rejects.toThrow();
  });
});
