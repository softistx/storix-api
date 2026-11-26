import { describe, expect, test } from "bun:test";
import type { FilesMongo } from "../models";
import {
  cannotAfford,
  orphanBrake,
  removeObjects,
  type Sweep,
  type SweepBucket,
  sizesOf,
} from "./sweep.utils";

type Page = { items: { key: string }[]; nextCursor: string | null };

function run(bucket: Partial<SweepBucket>, batch = 2) {
  const logs: string[] = [];
  const sweep: Sweep = {
    mongo: {} as FilesMongo,
    bucket: bucket as SweepBucket,
    workspaceId: "w1",
    log: (message: string) => logs.push(message),
    now: () => new Date(),
    margin: 0,
    batch,
    left: 10,
    max: 10,
    graceMs: 0,
    renew: async () => true,
    lost: false,
    report: {
      released: 0,
      orphans: 0,
      failed: 0,
      braked: false,
      capped: false,
    },
  };
  return { sweep, logs };
}

describe("removeObjects", () => {
  test("deletes each key, counts the budget and reports no failure", async () => {
    const deleted: string[] = [];
    const { sweep } = run({
      delete: (async ({ key }: { key: string }) => {
        deleted.push(key);
      }) as SweepBucket["delete"],
    });
    expect(await removeObjects(sweep, ["a", "b"])).toBe(0);
    expect(deleted).toEqual(["a", "b"]);
    expect(sweep.left).toBe(8);
  });

  test("counts only what was removed against the cap", async () => {
    const { sweep } = run({
      delete: (async ({ key }: { key: string }) => {
        if (key === "a") throw new Error("down");
      }) as SweepBucket["delete"],
    });
    await removeObjects(sweep, ["a", "b"]);
    expect(sweep.left).toBe(9);
  });

  test("logs a failed delete, counts it and goes on", async () => {
    const { sweep, logs } = run({
      delete: (async ({ key }: { key: string }) => {
        if (key === "a") throw new Error("down");
      }) as SweepBucket["delete"],
    });
    expect(await removeObjects(sweep, ["a", "b"])).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("a not removed: down");
  });
});

describe("sizesOf", () => {
  test("lists every key under the object, page after page", async () => {
    const pages: Page[] = [
      { items: [{ key: "o/thumb" }, { key: "o/preview" }], nextCursor: "c1" },
      { items: [{ key: "o/square" }], nextCursor: null },
    ];
    const prefixes: string[] = [];
    const { sweep } = run({
      list: (async ({ prefix }: { prefix: string }) => {
        prefixes.push(prefix);
        return pages.shift();
      }) as unknown as SweepBucket["list"],
    });
    expect(await sizesOf(sweep, "o")).toEqual([
      "o/thumb",
      "o/preview",
      "o/square",
    ]);
    expect(prefixes).toEqual(["o/", "o/"]);
  });
});

describe("cannotAfford", () => {
  test("fits within what is left, else marks the run capped", () => {
    const { sweep } = run({});
    expect(cannotAfford(sweep, 10)).toBe(false);
    sweep.left = 2;
    expect(cannotAfford(sweep, 3)).toBe(true);
    expect(sweep.report.capped).toBe(true);
  });

  test("a key larger than the whole cap still goes first", () => {
    const { sweep } = run({});
    sweep.left = sweep.max = 2;
    expect(cannotAfford(sweep, 3)).toBe(false);
    expect(sweep.report.capped).toBe(false);
  });
});

describe("orphanBrake", () => {
  test("needs ten unrecorded keys, then no recorded blob or over half of them", () => {
    expect(orphanBrake(9, 0)).toBe(false);
    expect(orphanBrake(10, 0)).toBe(true);
    expect(orphanBrake(10, 20)).toBe(false);
    expect(orphanBrake(11, 20)).toBe(true);
  });
});
