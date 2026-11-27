import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drillScript, restoreScript } from "./restore-script";

// The embedded programs, run with stubs of mc, mongosh, mongod, mongodump and
// mongorestore first in PATH; each stub appends its argv to calls.log. The real
// backup-lib, tar and mktemp run.
const lib = join(import.meta.dir, "backup", "backup-lib");
let root: string;
let bin: string;
let backups: string;
let base: string;

const stub = async (name: string, body = "") => {
  const path = join(bin, name);
  await writeFile(
    path,
    `#!/bin/sh\necho "${name} $*" >> "${root}/calls.log"\n${body}\n`,
  );
  chmodSync(path, 0o755);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "restore-script-"));
  bin = join(root, "bin");
  backups = join(root, "backups");
  base = join(root, "tmp");
  await Promise.all([mkdir(bin), mkdir(backups), mkdir(base)]);
  await stub("mc");
  await stub("mongosh", 'printf "%s\\n" $DBS');
  await stub("mongod");
  await stub(
    "mongodump",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax
    '[ "$FAIL_DB" = "" ] || case "$*" in *--db=$FAIL_DB*) exit 3;; esac\nfor a in "$@"; do case "$a" in --archive=*) echo dump > "${a#--archive=}" ;; esac; done',
  );
  await stub("mongorestore");
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** A dump tar in the backups folder holding `names` as files. */
async function tarOf(names: string[]) {
  const dir = join(root, "content");
  await mkdir(dir, { recursive: true });
  for (const n of names) await writeFile(join(dir, n), "x");
  const t = Bun.spawnSync([
    "tar",
    "-cf",
    join(backups, "mongo-20261110T030000Z.tar"),
    "-C",
    dir,
    ...names,
  ]);
  expect(t.exitCode).toBe(0);
}

const env = {
  RESTORE_URI: "mongodb://root:rootpw@mongo:27017/?replicaSet=rs0",
  CORE: "storix_core",
  ORG_PREFIX: "storix_ws_",
  DUMP: "latest",
  FROM_OFFSITE: "",
  FROM_PREFIX: "",
  MEDIA: "",
  DATABASE: "",
  S3_ENDPOINT: "http://minio:9000",
  S3_ACCESS_KEY: "live",
  S3_SECRET_KEY: "s",
  S3_BUCKET: "m",
  BACKUP_S3_ENDPOINT: "https://s3.example.com",
  BACKUP_S3_BUCKET: "bk",
  BACKUP_S3_ACCESS_KEY: "off",
  BACKUP_S3_SECRET_KEY: "o",
  BACKUP_S3_PREFIX: "storix",
  DBS: "admin config local other storix_core storix_ws_a",
};

async function run(script: string, extra: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", "-c", script], {
    env: {
      PATH: `${bin}:${Bun.env["PATH"]}`,
      BACKUP_LIB: lib,
      BACKUPS_DIR: backups,
      TMPBASE: base,
      SCRATCH: "drill_20261110T030000Z_",
      ...env,
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}
const calls = async () =>
  (await readFile(join(root, "calls.log"), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean);
const restores = async () =>
  (await calls()).filter(
    (l) => l.startsWith("mongorestore ") && l.includes("--drop"),
  );

describe("restoreScript, full-instance dump", () => {
  test("restores only the core and workspace databases, each with nsInclude", async () => {
    await tarOf(["instance.archive.gz"]);
    const { code } = await run(restoreScript);
    expect(code).toBe(0);
    const live = await restores();
    expect(live).toHaveLength(2);
    expect(live.join("\n")).toContain("--nsInclude=storix_core.*");
    expect(live.join("\n")).toContain("--nsInclude=storix_ws_a.*");
    for (const l of live) {
      expect(l).toContain("--gzip");
      expect(l).not.toContain("admin");
      expect(l).not.toContain("other");
    }
    // The replay itself targets the scratch mongod, with the oplog.
    expect((await calls()).join("\n")).toContain(
      "mongorestore --uri=mongodb://127.0.0.1:27018 --gzip --archive=",
    );
    expect((await calls()).join("\n")).toContain("--oplogReplay");
  });

  test("the scratch mongod listens on loopback and its folder is gone after exit", async () => {
    await tarOf(["instance.archive.gz"]);
    await run(restoreScript);
    const mongod = (await calls()).find((l) => l.includes("--fork")) ?? "";
    expect(mongod).toContain("--bind_ip 127.0.0.1");
    expect(readdirSync(base)).toEqual([]);
  });

  test("a failing mongodump of the LAST database restores nothing live (two passes)", async () => {
    await tarOf(["instance.archive.gz"]);
    // The workspace database is dumped after the core one: on a one-pass loop
    // the core database would already be restored when this dump fails.
    const { code } = await run(restoreScript, { FAIL_DB: "storix_ws_a" });
    expect(code).not.toBe(0);
    expect(await restores()).toEqual([]);
    expect(readdirSync(base)).toEqual([]);
  });

  test("DATABASE restores only that database", async () => {
    await tarOf(["instance.archive.gz"]);
    const { code } = await run(restoreScript, { DATABASE: "storix_ws_a" });
    expect(code).toBe(0);
    const live = await restores();
    expect(live).toHaveLength(1);
    expect(live[0]).toContain("--nsInclude=storix_ws_a.*");
  });

  test("a second restore at once is refused with its cause", async () => {
    await tarOf(["instance.archive.gz"]);
    await mkdir(join(base, "scratch.lock"));
    const { code, err } = await run(restoreScript);
    expect(code).not.toBe(0);
    expect(err).toContain("another restore or drill is running");
    expect(await restores()).toEqual([]);
  });

  test("an archive too big for the free space is refused", async () => {
    await tarOf(["instance.archive.gz"]);
    await stub(
      "df",
      'printf "Filesystem 1K-blocks Used Available\\nx 1 1 0\\n"',
    );
    const { code, err } = await run(restoreScript);
    expect(code).not.toBe(0);
    expect(err).toContain("not enough free space");
    expect(await restores()).toEqual([]);
  });
});

describe("restoreScript, tar from before the oplog dump", () => {
  test("restores each database archive, with no scratch mongod and no oplog", async () => {
    await tarOf([
      "storix_core.archive.gz",
      "storix_ws_a.archive.gz",
      "admin.archive.gz",
    ]);
    const { code } = await run(restoreScript);
    expect(code).toBe(0);
    expect(await restores()).toHaveLength(2);
    const log = (await calls()).join("\n");
    expect(log).not.toContain("mongod ");
    expect(log).not.toContain("--oplogReplay");
  });
});

describe("drillScript", () => {
  test("restores the storix databases under scratch names only", async () => {
    await tarOf(["instance.archive.gz"]);
    const { code } = await run(drillScript);
    expect(code).toBe(0);
    const log = (await calls()).filter((l) => l.includes("--nsFrom"));
    expect(log).toHaveLength(2);
    expect(log.join("\n")).toContain(
      "--nsFrom=storix_core.* --nsTo=drill_20261110T030000Z_core.*",
    );
    expect(log.join("\n")).toContain("--nsTo=drill_20261110T030000Z_ws_a.*");
    expect(existsSync(join(base, "scratch.lock"))).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });
});
