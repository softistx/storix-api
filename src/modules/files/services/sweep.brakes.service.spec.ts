import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import type { SweepBucket } from "./index";
import { ORPHAN_BRAKE, RELEASED_BRAKE } from "./index";
import { area as areaOf, HOUR, later } from "./sweep.harness";

// The sweep's brakes against a real S3 API and the real Mongo.
const files = filesWorld();
const area = () => areaOf(files);

const strays = async (a: Awaited<ReturnType<typeof area>>, n: number) => {
  for (let i = 0; i < n; i++) await a.stray();
};

describe("the orphan brake", () => {
  test("it holds for the whole run: the claims of earlier pages never lift it", async () => {
    const a = await area();
    await strays(a, ORPHAN_BRAKE + 2);
    const logs: string[] = [];
    const report = await a.sweep({
      now: later,
      batch: 3,
      log: (m: string) => logs.push(m),
    });
    expect(report).toMatchObject({ braked: true, orphans: 0, released: 0 });
    // Decided on a dry pass: not one claim was made.
    expect(await a.mongo.db.blobs.raw.countDocuments({})).toBe(0);
    expect(await a.keys()).toHaveLength(ORPHAN_BRAKE + 2);
    expect(logs.some((m) => m.includes("stopped"))).toBe(true);
  });

  test("a stale non-empty database is braked: old keys over half the recorded blobs", async () => {
    const a = await area();
    const up = await a.upload("recorded");
    expect((await a.record(up.key, "recorded.txt")).errors).toBeUndefined();
    await strays(a, ORPHAN_BRAKE);
    const report = await a.sweep({ now: later });
    expect(report).toMatchObject({ braked: true, orphans: 0 });
    expect(await a.keys()).toHaveLength(ORPHAN_BRAKE + 1);
  });

  test("a mixed page well covered by recorded blobs is swept", async () => {
    const a = await area();
    for (let i = 0; i < 2 * ORPHAN_BRAKE + 1; i++) {
      const up = await a.upload(`kept${i}`);
      await a.mongo.db.blobs.create({
        key: up.key,
        size: 1,
        mimeType: "text/plain",
        refs: 1,
      });
    }
    await strays(a, ORPHAN_BRAKE);
    const report = await a.sweep({ now: later });
    expect(report).toMatchObject({ braked: false, orphans: ORPHAN_BRAKE });
    expect(await a.keys()).toHaveLength(2 * ORPHAN_BRAKE + 1);
  });
});

describe("the clock brake", () => {
  test("an object dated in the future stops the workspace", async () => {
    const a = await area();
    await a.stray();
    const skewed: SweepBucket = {
      delete: (...args) => a.bucket.delete(...args),
      list: async (...args) => {
        const page = await a.bucket.list(...args);
        const at = new Date(Date.now() + 3 * HOUR);
        return {
          ...page,
          items: page.items.map((item) => ({ ...item, lastModified: at })),
        };
      },
    };
    const logs: string[] = [];
    const report = await a.sweep(
      { now: later, log: (m: string) => logs.push(m) },
      skewed,
    );
    expect(report).toMatchObject({ braked: true, orphans: 0 });
    expect(await a.keys()).toHaveLength(1);
    expect(logs.some((m) => m.includes("future"))).toBe(true);
  });
});

describe("the released brake", () => {
  test("a mass of released blobs over the recorded ones is not removed", async () => {
    const a = await area();
    const docs = Array.from({ length: RELEASED_BRAKE }, (_, i) => ({
      key: `mass-${i}`,
      size: 1,
      mimeType: "text/plain",
      refs: 0,
      releasedAt: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await a.mongo.db.blobs.raw.insertMany(docs as never);
    const report = await a.sweep();
    expect(report).toMatchObject({ braked: true, released: 0 });
    expect(await a.mongo.db.blobs.raw.countDocuments({})).toBe(RELEASED_BRAKE);
  });
});
