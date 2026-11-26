import { describe, expect, test } from "bun:test";
import { newMediaKey } from "@softistx/alxia-media";
import type { FilesMongo } from "../models";
import {
  cannotAfford,
  oldKeysOf,
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

describe("oldKeysOf", () => {
  const prefix = "workspaces/w1/files/";
  const at = (ms: number) => new Date(Date.now() + ms);
  const item = (key: string, lastModified: Date) => ({
    key: prefix + key,
    lastModified,
  });
  // The margin is 0 here: "old" is anything before now.
  const keyA = newMediaKey();
  const keyB = newMediaKey();

  test("keeps the objects last written before the margin, grouped by key", () => {
    const { sweep } = run({});
    const { old, future } = oldKeysOf(
      sweep,
      [
        item(`${keyA}`, at(-60_000)),
        item(`${keyA}/thumb`, at(-60_000)),
        item(`${keyB}`, at(60_000)),
      ] as never,
      prefix,
    );
    expect([...old.keys()]).toEqual([keyA]);
    expect(old.get(keyA)).toEqual([
      `${prefix}${keyA}`,
      `${prefix}${keyA}/thumb`,
    ]);
    expect(future).toBe(false);
  });

  test("ignores a name that is not a media key", () => {
    const { sweep } = run({});
    const { old } = oldKeysOf(
      sweep,
      [item("notes.txt", at(-60_000))] as never,
      prefix,
    );
    expect(old.size).toBe(0);
  });

  test("flags an object dated beyond the clock skew tolerance", () => {
    const { sweep } = run({});
    const inside = oldKeysOf(sweep, [item(keyA, at(60_000))] as never, prefix);
    expect(inside.future).toBe(false);
    const beyond = oldKeysOf(
      sweep,
      [item(keyA, at(10 * 60_000))] as never,
      prefix,
    );
    expect(beyond.future).toBe(true);
  });
});
