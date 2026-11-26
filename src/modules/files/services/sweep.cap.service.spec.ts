import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import type { SweepBucket } from "./index";
import { SWEEP_LOCK_MS } from "./index";
import { area as areaOf, later } from "./sweep.harness";

// The per-run cap and the lease, on a real S3 API and the real Mongo.
const files = filesWorld();
const area = () => areaOf(files);

describe("the delete cap", () => {
  test("a key whose objects do not fit is left whole, and the run is capped", async () => {
    const a = await area();
    await a.stray(undefined, ["thumb", "preview"]);
    await a.stray(undefined, ["thumb", "preview"]);
    const report = await a.sweep({ now: later, maxDeletes: 4 });
    // 3 objects fit; the second key needs 3 and 1 is left: it stays whole.
    expect(report).toMatchObject({ orphans: 3, capped: true, braked: false });
    expect(await a.keys()).toHaveLength(3);
  });

  test("a run that stays within the cap is not capped", async () => {
    const a = await area();
    await a.stray(undefined, ["thumb"]);
    const report = await a.sweep({ now: later, maxDeletes: 2 });
    expect(report).toMatchObject({ orphans: 2, capped: false });
  });

  test("a failed delete is not counted against the cap", async () => {
    const a = await area();
    for (let i = 0; i < 3; i++) await a.stray();
    const down: SweepBucket = {
      list: (...args) => a.bucket.list(...args),
      delete: () => Promise.reject(new Error("down")),
    };
    const report = await a.sweep({ now: later, maxDeletes: 2 }, down);
    expect(report).toMatchObject({ failed: 3, orphans: 0, capped: false });
  });
});

describe("the lease", () => {
  test("it is renewed on every page, not only between the steps", async () => {
    const a = await area();
    for (let i = 0; i < 3; i++) await a.stray();
    const seen: number[] = [];
    const watching: SweepBucket = {
      delete: (...args) => a.bucket.delete(...args),
      list: async (...args) => {
        const lock = await a.mongo.db.sweepLocks.raw.findOne({ _id: "sweep" });
        seen.push(lock?.until?.getTime() ?? 0);
        return a.bucket.list(...args);
      },
    };
    let tick = 0;
    const base = Date.now() + 2 * 60 * 60_000;
    await a.sweep(
      { now: () => new Date(base + tick++ * 60_000), batch: 1 },
      watching,
    );
    expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen) + 60_000);
    expect(SWEEP_LOCK_MS).toBeGreaterThan(0);
  });
});
