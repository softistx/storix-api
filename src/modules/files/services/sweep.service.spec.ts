import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { filesWorld } from "../../../../test/files.harness";
import type { SweepBucket } from "./index";
import { recountStorage } from "./index";
import { afterGrace, area as areaOf, later } from "./sweep.harness";

// The orphan sweep against a real S3 API and the real Mongo: released blobs
// with their sizes, and objects nobody recorded once they are old enough.
const files = filesWorld();
const area = () => areaOf(files);

describe("the orphan sweep", () => {
  test("a released blob goes with its object and its sizes", async () => {
    const a = await area();
    const key = await a.stray(undefined, ["thumb", "preview"]);
    await a.mongo.db.blobs.create({
      key,
      size: 1,
      mimeType: "text/plain",
      refs: 0,
      releasedAt: new Date(0),
    });
    const report = await a.sweep();
    expect(report).toMatchObject({ released: 1, failed: 0 });
    expect(await a.keys()).toEqual([]);
    expect(await a.mongo.db.blobs.findFirst({ key })).toBeUndefined();
  });

  test("a blob that is still referenced is kept, however old", async () => {
    const a = await area();
    const up = await a.upload("kept");
    expect((await a.record(up.key, "kept.txt")).errors).toBeUndefined();
    const report = await a.sweep({ now: later });
    expect(report).toEqual({
      released: 0,
      orphans: 0,
      failed: 0,
      braked: false,
      capped: false,
    });
    expect(await a.keys()).toEqual([a.place(up.key)]);
  });

  test("an unrecorded object is kept until it is 75 minutes old, then removed with its sizes", async () => {
    const a = await area();
    const kept = await a.upload("recorded");
    await a.record(kept.key, "recorded.txt");
    const orphan = await a.stray(undefined, ["thumb"]);
    expect((await a.sweep()).orphans).toBe(0);
    expect(await a.keys()).toHaveLength(3);
    const report = await a.sweep({ now: later });
    expect(report).toMatchObject({ orphans: 2, failed: 0 });
    expect(await a.keys()).toEqual([a.place(kept.key)]);
    // The claim stays, released, for the run after the grace window: the key
    // cannot be recorded meanwhile.
    expect(await a.mongo.db.blobs.findFirst({ key: orphan })).toMatchObject({
      refs: 0,
    });
    expect(await a.sweep({ now: later })).toMatchObject({ released: 0 });
    expect(await a.sweep({ now: afterGrace })).toMatchObject({ released: 1 });
    expect(await a.mongo.db.blobs.findFirst({ key: orphan })).toBeUndefined();
  });

  test("it leaves usage equal to a recount", async () => {
    const a = await area();
    const up = await a.upload("counted");
    await a.record(up.key, "counted.txt");
    await a.stray();
    const stored = async () =>
      (await store.core.db.workspaces.getById(a.id)).usage;
    const before = await stored();
    await a.sweep({ now: later });
    const after = await stored();
    expect(after).toEqual(before);
    const recount = await recountStorage(a.mongo);
    expect({
      bytes: after.bytes,
      files: after.files,
      versionBytes: after.versionBytes,
      trashBytes: after.trashBytes,
    }).toEqual(recount);
  });

  test("a failed delete is logged, counted and retried by the next run", async () => {
    const a = await area();
    const orphan = await a.stray();
    const logs: string[] = [];
    let broken = true;
    const flaky: SweepBucket = {
      list: (...args) => a.bucket.list(...args),
      delete: (...args) =>
        broken ? Promise.reject(new Error("down")) : a.bucket.delete(...args),
    };
    const first = await a.sweep(
      { now: later, log: (m: string) => logs.push(m) },
      flaky,
    );
    expect(first).toMatchObject({ orphans: 0, failed: 1 });
    expect(logs.some((m) => m.includes(orphan))).toBe(true);
    broken = false;
    // The kept claim is a released blob: the run after the grace window
    // retries its delete.
    expect(await a.sweep({ now: afterGrace }, flaky)).toMatchObject({
      released: 1,
      failed: 0,
    });
    expect(await a.keys()).toEqual([]);
  });

  test("the brake: ten old keys and no blob at all are not swept", async () => {
    const a = await area();
    for (let i = 0; i < 10; i++) await a.stray();
    const logs: string[] = [];
    const report = await a.sweep({
      now: later,
      log: (m: string) => logs.push(m),
    });
    expect(report).toMatchObject({ orphans: 0, braked: true });
    expect(await a.keys()).toHaveLength(10);
    expect(logs.some((m) => m.includes("stopped"))).toBe(true);
  });
});
