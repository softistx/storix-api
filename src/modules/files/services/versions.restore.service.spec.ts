import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import {
  DELETE,
  RESTORE,
  versionsArea,
} from "../../../../test/versions.harness";

const files = filesWorld();

describe("restoring and deleting a version", () => {
  test("a restore adds a version that holds the old blob: no new blob, no new object", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.push(file.id, "twenty");
    const blobs = await a.mongo.db.blobs.raw.countDocuments({});
    const objects = (await files.ctx.bucket.list({ prefix: "", limit: 1000 }))
      .items.length;
    const v1 = (await a.versions(file.id)).find((v) => v.number === 1);
    const result = await a.send(RESTORE, {
      fileId: file.id,
      versionId: v1?.id,
      note: "back",
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["restoreFileVersion"]).toMatchObject({
      key: file.key,
      size: 3,
    });
    const list = await a.versions(file.id);
    expect(list.map((v) => v.number)).toEqual([3, 2, 1]);
    expect(list[0]).toMatchObject({
      current: true,
      restoredFrom: 1,
      key: file.key,
      note: "back",
    });
    expect(await a.mongo.db.blobs.raw.countDocuments({})).toBe(blobs);
    expect(
      (await files.ctx.bucket.list({ prefix: "", limit: 1000 })).items.length,
    ).toBe(objects);
    expect(await a.usage()).toMatchObject({ bytes: 9, versionBytes: 6 });
  });

  test("the current version is refused for restore and delete; an unknown one is not-found", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    const [current] = await a.versions(file.id);
    for (const query of [RESTORE, DELETE]) {
      const result = await a.send(query, {
        fileId: file.id,
        versionId: current?.id,
      });
      expect(result.errors?.[0]?.extensions?.["code"]).toBe(
        "versions.errors.is-current",
      );
    }
    const missing = await a.send(DELETE, {
      fileId: file.id,
      versionId: "5f1f1f1f1f1f1f1f1f1f1f1f",
    });
    expect(missing.errors?.[0]?.extensions?.["code"]).toBe(
      "versions.errors.not-found",
    );
    const bad = await a.send(DELETE, { fileId: file.id, versionId: "zz" });
    expect(bad.errors?.[0]?.extensions?.["code"]).toBe(
      "versions.errors.not-found",
    );
  });

  test("deleting an old version drops its row, releases its blob and the usage", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.push(file.id, "twenty");
    const v1 = (await a.versions(file.id)).find((v) => v.number === 1);
    const result = await a.send(DELETE, {
      fileId: file.id,
      versionId: v1?.id,
    });
    expect(result.errors).toBeUndefined();
    expect((await a.versions(file.id)).map((v) => v.number)).toEqual([2]);
    const blob = await a.mongo.db.blobs.findFirst({ key: file.key });
    expect(blob?.refs).toBe(0);
    expect(await a.usage()).toMatchObject({ bytes: 6, versionBytes: 0 });
  });

  test("a deleted number is never reused", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.push(file.id, "two");
    const [two] = await a.versions(file.id);
    await a.push(file.id, "three");
    await a.send(DELETE, { fileId: file.id, versionId: two?.id });
    await a.push(file.id, "four");
    expect((await a.versions(file.id)).map((v) => v.number)).toEqual([4, 3, 1]);
  });
});
