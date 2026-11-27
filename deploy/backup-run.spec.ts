import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// backup-run with stubs first in PATH for mc, mongosh, mongodump and
// backup-alert; the real tar, mktemp and backup-prune run. Each stub appends
// its arguments to calls.log, so the specs also check what reaches a command line.
const backupDir = join(import.meta.dir, "backup");
let root: string;
let data: string;
let bin: string;

const stub = async (name: string, body: string) => {
  const path = join(bin, name);
  await writeFile(
    path,
    `#!/bin/sh\necho "${name} $*" >> "${root}/calls.log"\n${body}\n`,
  );
  chmodSync(path, 0o755);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "backup-run-"));
  data = join(root, "data");
  bin = join(root, "bin");
  await mkdir(data);
  await mkdir(bin);
  await stub(
    "mc",
    "env | grep '^MC_HOST_' >> " +
      `"${root}/mc-env.log"` +
      '\n[ -z "$MC_FAIL" ]',
  );
  await stub("mongosh", 'printf "%s\\n" $DBS');
  await stub(
    "mongodump",
    // --archive=<path>: write something there, unless asked to fail.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax
    '[ -z "$DUMP_FAIL" ] || exit 3\nfor a in "$@"; do case "$a" in --archive=*) echo dump > "${a#--archive=}" ;; esac; done',
  );
  await stub("backup-alert", "exit 0");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const env = {
  MONGO_URI: "mongodb://app:pw0rd@mongo:27017/?authSource=admin",
  MONGO_CORE_DATABASE: "storix_core",
  MONGO_WORKSPACE_PREFIX: "storix_ws_",
  S3_ENDPOINT: "http://minio:9000",
  S3_ACCESS_KEY: "live",
  S3_SECRET_KEY: "live/secret+1",
  S3_BUCKET: "storix-media",
  BACKUP_S3_ENDPOINT: "https://s3.example.com",
  BACKUP_S3_BUCKET: "bk",
  BACKUP_S3_ACCESS_KEY: "off",
  BACKUP_S3_SECRET_KEY: "off-secret",
  DBS: "admin storix_core storix_ws_a other",
};

async function run(extra: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", join(backupDir, "backup-run")], {
    env: {
      PATH: `${bin}:${backupDir}:${Bun.env["PATH"]}`,
      BACKUP_DIR: data,
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

const calls = () => readFile(join(root, "calls.log"), "utf8").catch(() => "");
const files = () => readdirSync(data).sort();

describe("backup-run", () => {
  test("dumps the whole instance once, with the oplog, uploads, records the success", async () => {
    const { code } = await run();
    expect(code).toBe(0);
    const log = await calls();
    // One full-instance dump (point-in-time consistent): no --db, no per-database run.
    expect(log.match(/^mongodump /gm)).toHaveLength(1);
    expect(log).toContain("--oplog --gzip --archive=");
    expect(log).toContain("/instance.archive.gz");
    expect(log).not.toContain("--db=");
    expect(log).toContain("mc cp --quiet");
    expect(log).toContain(
      "mc mirror --quiet --overwrite local/storix-media offsite/bk/storix/media",
    );
    const names = files();
    expect(names).toContain("last-success");
    expect(
      names.filter((n) => /^mongo-\d{8}T\d{6}Z\.tar$/.test(n)),
    ).toHaveLength(1);
    expect(
      names.some((n) => n.startsWith(".work-") || n.endsWith(".part")),
    ).toBe(false);
  });

  test("no secret reaches a command line; mc gets its aliases from the environment", async () => {
    await run();
    const log = await calls();
    for (const secret of ["pw0rd", "live/secret", "off-secret"])
      expect(log).not.toContain(secret);
    const mcEnv = await readFile(join(root, "mc-env.log"), "utf8");
    // The secret is percent-encoded in the URL.
    expect(mcEnv).toContain(
      "MC_HOST_local=http://live:live%2Fsecret%2B1@minio:9000",
    );
    expect(mcEnv).toContain(
      "MC_HOST_offsite=https://off:off-secret@s3.example.com",
    );
  });

  test("a failed dump fails the run, alerts, and leaves no partial file or success mark", async () => {
    const { code, err } = await run({ DUMP_FAIL: "1" });
    expect(code).not.toBe(0);
    expect(err).toContain("backup: FAILED");
    expect(await calls()).toContain("backup-alert failed");
    expect(files()).toEqual([]);
    expect(existsSync(join(data, "last-success"))).toBe(false);
  });

  test("the tar holds the one instance archive", async () => {
    await run();
    const tar = files().find((n) => n.endsWith(".tar")) ?? "";
    const list = Bun.spawnSync(["tar", "-tf", join(data, tar)]);
    const entries = list.stdout
      .toString()
      .split("\n")
      .map((l) => l.replace(/^\.\//, ""))
      .filter((l) => l !== "" && l !== ".");
    expect(entries).toEqual(["instance.archive.gz"]);
  });

  test("a failed upload keeps the dump but records no success", async () => {
    const { code } = await run({ MC_FAIL: "1" });
    expect(code).not.toBe(0);
    expect(await calls()).toContain("backup-alert failed");
    expect(files().some((n) => n.endsWith(".tar"))).toBe(true);
    expect(files()).not.toContain("last-success");
  });

  test("a missing core database fails the run", async () => {
    const { code, err } = await run({ DBS: "admin storix_ws_a" });
    expect(code).not.toBe(0);
    expect(err).toContain("core database storix_core not found");
    expect(files()).toEqual([]);
  });

  test("SIGTERM stops the running dump, exits 143, alerts and leaves nothing behind", async () => {
    // A dump that hangs; the stub records its pid so the spec can check it is gone.
    await stub("mongodump", `echo $$ > "${root}/dump.pid"; exec sleep 30`);
    const proc = Bun.spawn(["sh", join(backupDir, "backup-run")], {
      env: {
        PATH: `${bin}:${backupDir}:${Bun.env["PATH"]}`,
        BACKUP_DIR: data,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidFile = join(root, "dump.pid");
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(50);
    expect(existsSync(pidFile)).toBe(true);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(143);
    expect(await calls()).toContain("backup-alert failed");
    expect(files()).toEqual([]);
  });

  test("cleanup waits for the killed child: it never runs while the child is alive", async () => {
    await stub("backup-prune", "exit 0");
    // A dump that needs a second to die after TERM and logs when it is gone.
    await stub(
      "mongodump",
      `trap 'kill $s; sleep 1; echo dump-exited >> "${root}/calls.log"; exit 0' TERM\necho $$ > "${root}/dump.pid"\nsleep 30 &\ns=$!\nwait $s`,
    );
    const proc = Bun.spawn(["sh", join(backupDir, "backup-run")], {
      env: {
        PATH: `${bin}:${backupDir}:${Bun.env["PATH"]}`,
        BACKUP_DIR: data,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidFile = join(root, "dump.pid");
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(50);
    expect(existsSync(pidFile)).toBe(true);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(143);
    const lines = (await calls()).split("\n");
    const exited = lines.indexOf("dump-exited");
    expect(exited).toBeGreaterThan(-1);
    expect(
      lines.findIndex((l) => l.startsWith("backup-prune")),
    ).toBeGreaterThan(exited);
    expect(
      lines.findIndex((l) => l.startsWith("backup-alert failed")),
    ).toBeGreaterThan(exited);
  });
});
