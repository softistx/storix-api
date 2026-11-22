import { describe, expect, test } from "bun:test";
import type { FilesMongo } from "../models";
import {
  removeObjects,
  type Sweep,
  type SweepBucket,
  sizesOf,
} from "./sweep.utils";

type Page = { items: { key: string }[]; nextCursor: string | null };

function run(bucket: Partial<SweepBucket>, batch = 2) {
  const logs: string[] = [];
  const sweep = {
    mongo: {} as FilesMongo,
    bucket: bucket as SweepBucket,
    workspaceId: "w1",
    log: (message: string) => logs.push(message),
    now: () => new Date(),
    margin: 0,
    batch,
    left: 10,
    report: { released: 0, orphans: 0, failed: 0 },
  } satisfies Sweep;
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
