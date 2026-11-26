import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { filesWorld } from "../../../../test/files.harness";
import { afterGrace, area as areaOf, HOUR } from "./sweep.harness";

// Released blobs wait out the grace window and are never removed under a
// holder, on a real S3 API and the real Mongo.
const files = filesWorld();
const area = () => areaOf(files);

type Area = Awaited<ReturnType<typeof area>>;
const holdByVersion = (a: Area, key: string) =>
  a.mongo.db.versions.raw.insertOne({
    fileId: new ObjectId(),
    number: 1,
    blobKey: key,
    size: 1,
    mimeType: "text/plain",
    createdBy: "someone",
    note: null,
    restoredFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
const released = async (a: Area, at: Date) => {
  const key = await a.stray();
  await a.mongo.db.blobs.create({
    key,
    size: 1,
    mimeType: "text/plain",
    refs: 0,
    releasedAt: at,
  });
  return key;
};

describe("the grace window of a released blob", () => {
  test("a blob released an hour ago is kept, one released over a day ago goes", async () => {
    const a = await area();
    const fresh = await released(a, new Date(Date.now() - HOUR));
    const old = await released(a, new Date(Date.now() - 25 * HOUR));
    const report = await a.sweep();
    expect(report).toMatchObject({ released: 1, failed: 0 });
    expect(await a.mongo.db.blobs.findFirst({ key: old })).toBeUndefined();
    expect(await a.keys()).toEqual([a.place(fresh)]);
    expect(await a.sweep({ now: afterGrace })).toMatchObject({ released: 1 });
    expect(await a.keys()).toEqual([]);
  });

  test("a blob with no release date is never removed", async () => {
    const a = await area();
    const key = await a.stray();
    await a.mongo.db.blobs.raw.insertOne({
      key,
      size: 1,
      mimeType: "text/plain",
      refs: 0,
      releasedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    expect(await a.sweep({ now: afterGrace })).toMatchObject({ released: 0 });
    expect(await a.keys()).toEqual([a.place(key)]);
  });

  test("a claim is released now, so it waits out the window too", async () => {
    const a = await area();
    const key = await a.stray();
    await a.sweep({ now: () => new Date(Date.now() + 2 * HOUR) });
    const claim = await a.mongo.db.blobs.findFirst({ key });
    expect(claim?.releasedAt?.getTime()).toBeGreaterThan(Date.now() + HOUR);
  });
});

describe("a refs 0 blob something still holds", () => {
  test("a node holding the key keeps the blob and its object, and it is logged", async () => {
    const a = await area();
    const up = await a.upload("held");
    expect((await a.record(up.key, "held.txt")).errors).toBeUndefined();
    await a.mongo.db.blobs.raw.updateMany(
      { key: up.key },
      { $set: { refs: 0, releasedAt: new Date(0) } },
    );
    const logs: string[] = [];
    const report = await a.sweep({ log: (m: string) => logs.push(m) });
    expect(report.released).toBe(0);
    expect(await a.keys()).toEqual([a.place(up.key)]);
    expect(await a.mongo.db.blobs.findFirst({ key: up.key })).toBeDefined();
    expect(logs.some((m) => m.includes(up.key) && m.includes("node"))).toBe(
      true,
    );
  });

  test("a version holding the key keeps it too", async () => {
    const a = await area();
    const key = await released(a, new Date(0));
    await holdByVersion(a, key);
    const logs: string[] = [];
    const report = await a.sweep({ log: (m: string) => logs.push(m) });
    expect(report.released).toBe(0);
    expect(await a.keys()).toEqual([a.place(key)]);
    expect(logs.some((m) => m.includes("version"))).toBe(true);
  });

  test("the blobs after a kept one are still reached", async () => {
    const a = await area();
    const kept = await released(a, new Date(0));
    await holdByVersion(a, kept);
    for (let i = 0; i < 3; i++) await released(a, new Date(0));
    const report = await a.sweep({ batch: 2 });
    expect(report.released).toBe(3);
    expect(await a.keys()).toEqual([a.place(kept)]);
  });
});
