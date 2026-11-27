import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, utimesSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "backup", "backup-prune");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-prune-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function dump(name: string, daysOld: number) {
  const path = join(dir, name);
  await writeFile(path, "x");
  const t = new Date(Date.now() - daysOld * 86400_000);
  utimesSync(path, t, t);
}

async function prune(days = "14") {
  const proc = Bun.spawn(["sh", script], {
    env: {
      PATH: Bun.env["PATH"] ?? "",
      BACKUP_DIR: dir,
      BACKUP_RETENTION_DAYS: days,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exited;
}

const has = (name: string) => existsSync(join(dir, name));

describe("backup-prune", () => {
  test("old dumps go, recent ones stay", async () => {
    await dump("mongo-20261101T030000Z.tar", 20);
    await dump("mongo-20261108T030000Z.tar", 1);
    await dump("mongo-20261109T030000Z.tar", 0);
    expect(await prune()).toBe(0);
    expect(has("mongo-20261101T030000Z.tar")).toBe(false);
    expect(has("mongo-20261108T030000Z.tar")).toBe(true);
    expect(has("mongo-20261109T030000Z.tar")).toBe(true);
  });

  test("the newest finished dump survives even when it is past the window", async () => {
    await dump("mongo-20261001T030000Z.tar", 40);
    await dump("mongo-20261002T030000Z.tar", 39);
    expect(await prune()).toBe(0);
    expect(has("mongo-20261001T030000Z.tar")).toBe(false);
    expect(has("mongo-20261002T030000Z.tar")).toBe(true);
  });

  test(".part files and other files are neither the newest nor deleted", async () => {
    await dump("mongo-20261001T030000Z.tar", 40);
    await dump("mongo-20261109T030000Z.tar.part", 40);
    await dump("last-success", 40);
    expect(await prune()).toBe(0);
    // The only finished dump is the newest: kept; the .part is not a dump.
    expect(has("mongo-20261001T030000Z.tar")).toBe(true);
    expect(has("mongo-20261109T030000Z.tar.part")).toBe(true);
    expect(has("last-success")).toBe(true);
  });

  test("an empty volume is fine", async () => {
    expect(await prune()).toBe(0);
  });
});
