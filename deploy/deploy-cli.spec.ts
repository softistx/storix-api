import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "deploy.ts");
const root = mkdtempSync(join(tmpdir(), "deploy-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// docker, git and gh stand-ins that record every call: a dry run must call none.
const bin = join(root, "bin");
const calls = join(root, "calls.log");
mkdirSync(bin);
for (const tool of ["docker", "git", "gh", "ssh", "curl"]) {
  const path = join(bin, tool);
  writeFileSync(path, `#!/bin/sh\necho "${tool} $*" >> "${calls}"\nexit 0\n`);
  chmodSync(path, 0o755);
}

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", script, ...args], {
    env: { PATH: `${bin}:${Bun.env["PATH"]}`, HOME: root, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

const example = readFileSync(join(import.meta.dir, ".env.example"), "utf8");
const filledFile = join(root, "filled.env");
const filled = example.replace(/=CHANGE_ME/g, "=a1b2c3");
// The smtp transport, so the dry run needs no bumail key file (deploy/secrets).
const base = `${filled}\nMAIL_TRANSPORT=smtp\nMAIL_URL=smtp://u:p@bumail:587\n`;
writeFileSync(filledFile, base);
// The default (bumail) transport: the key file is missing in a checkout.
const bumailFile = join(root, "bumail.env");
writeFileSync(bumailFile, filled);
// The same file with the opt-in backup settings.
const backupFile = join(root, "backup.env");
writeFileSync(
  backupFile,
  `${base}\nMONGO_BACKUP_PASSWORD=a1b2c3\nBACKUP_S3_ENDPOINT=https://s3.test\nBACKUP_S3_BUCKET=b\nBACKUP_S3_ACCESS_KEY=k\nBACKUP_S3_SECRET_KEY=s\n`,
);
chmodSync(backupFile, 0o644);
// Deliberately world-readable: a real run refuses it, a dry run only reads it.
chmodSync(filledFile, 0o644);

describe("deploy.ts --dry-run", () => {
  test("prints the plan of a complete env file, exits 0, touches no tool", async () => {
    const { code, out } = await run(["--dry-run", "--env", filledFile]);
    expect(code).toBe(0);
    expect(out).toContain("dry run: nothing is pulled, built, started");
    expect(out).toContain("docker network inspect proxy");
    expect(out).toContain("git -C ");
    expect(out).toContain("build");
    expect(out).toContain("--wait --wait-timeout 300");
    expect(out).toContain("--profile ops run --rm migrate");
    expect(out).toContain("the real run would go ahead");
    expect(out).toContain("backup off");
    expect(out).not.toContain("--profile backup");
    expect(out).toContain("docker image prune -f");
    expect(out).toContain("docker builder prune -f --filter until=24h");
    expect(out).not.toMatch(/system prune|--volumes/);
    expect(existsSync(calls)).toBe(false);
  });

  test("the default bumail transport needs the key file, which a dry run reports missing", async () => {
    const { code, out } = await run(["--dry-run", "--env", bumailFile]);
    expect(code).toBe(1);
    expect(out).toContain("mail_api_key");
  });

  test("--backup plans the backup profile and needs the offsite settings", async () => {
    const ok = await run(["--dry-run", "--backup", "--env", backupFile]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("--profile backup");
    expect(ok.out).not.toContain("backup off");
    const missing = await run(["--dry-run", "--backup", "--env", filledFile]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("BACKUP_S3_ENDPOINT is required");
    expect(missing.out).toContain("MONGO_BACKUP_PASSWORD is required");
    expect(existsSync(calls)).toBe(false);
  });

  test("the unfilled example exits 1 and lists what the real run would stop on", async () => {
    const { code, out } = await run([
      "--dry-run",
      "--env",
      join(import.meta.dir, ".env.example"),
    ]);
    expect(code).toBe(1);
    expect(out).toContain("the real run would stop on");
    expect(out).toContain("MONGO_APP_PASSWORD is required");
    expect(out).not.toContain("BACKUP_S3_ENDPOINT");
    expect(existsSync(calls)).toBe(false);
  });

  test("a missing env file is reported, not read", async () => {
    const { code, out } = await run([
      "--dry-run",
      "--env",
      join(root, "absent.env"),
    ]);
    expect(code).toBe(1);
    expect(out).toContain("absent.env is missing");
    expect(existsSync(calls)).toBe(false);
  });

  test("--ui and --no-pull change the plan; --timeout is checked", async () => {
    const ui = await run(["--dry-run", "--ui", "--env", filledFile]);
    expect(ui.out).toContain("--profile ui");
    const skip = await run(["--dry-run", "--no-pull", "--env", filledFile]);
    expect(skip.out).toContain("git pull (--no-pull)");
    expect(skip.out).not.toContain("pull --ff-only");
    const bad = await run(["--dry-run", "--timeout", "abc"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--timeout is a number of seconds");
    expect(existsSync(calls)).toBe(false);
  });

  test("an unknown flag stops before anything", async () => {
    const { code, err } = await run(["--dry-run", "--seed"]);
    expect(code).toBe(1);
    expect(err).toContain("unknown flag --seed");
    expect(existsSync(calls)).toBe(false);
  });
});

describe("deploy.ts without --dry-run", () => {
  test("refuses an env file others can read, before any tool runs", async () => {
    const { code, err } = await run(["--env", filledFile]);
    expect(code).toBe(1);
    expect(err).toContain("chmod 600");
    expect(existsSync(calls)).toBe(false);
  });
});
