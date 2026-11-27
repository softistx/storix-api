import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// backup-alert is a POSIX shell script that runs in the backup container with
// curl. These specs run it with a stub `curl` first in PATH that records its
// arguments and the message it was asked to upload.
const script = join(import.meta.dir, "backup", "backup-alert");

let root: string;
let backups: string;
let bin: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "backup-alert-"));
  backups = join(root, "backups");
  bin = join(root, "bin");
  await mkdir(backups);
  await mkdir(bin);
  const curl = join(bin, "curl");
  await writeFile(
    curl,
    `#!/bin/sh
echo "$@" >> "${root}/curl-args"
while [ $# -gt 0 ]; do
  [ "$1" = "--upload-file" ] && cp "$2" "${root}/curl-message"
  [ "$1" = "-K" ] && cat > "${root}/curl-config"
  shift
done
[ -z "$CURL_FAIL" ]
`,
  );
  chmodSync(curl, 0o755);
});

afterEach(() => rm(root, { recursive: true, force: true }));

const mail = {
  BACKUP_ALERT_TO: "ops@softistx.com",
  MAIL_URL:
    "smtp://no-reply%40softistx.com:s3cret@bumail:587?tls.servername=mail.softistx.com",
  MAIL_FROM: "no-reply@softistx.com",
};

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", script, ...args], {
    env: {
      PATH: `${bin}:${Bun.env["PATH"]}`,
      BACKUP_DIR: backups,
      ...env,
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

const calls = () => readFile(join(root, "curl-args"), "utf8").catch(() => "");
const sent = () => readFile(join(root, "curl-message"), "utf8");
const stamp = (seconds: number) =>
  String(Math.floor(Date.now() / 1000) - seconds);

describe("backup-alert", () => {
  test("does nothing without BACKUP_ALERT_TO", async () => {
    const { code } = await run(["failed", "exit 1"], {
      ...mail,
      BACKUP_ALERT_TO: "",
    });
    expect(code).toBe(0);
    expect(await calls()).toBe("");
  });

  test("failed: STARTTLS required, certificate name as SNI, From the allow-listed address", async () => {
    const { code, out } = await run(["failed", "exit 1"], mail);
    expect(code).toBe(0);
    expect(out).toContain("mailed ops@softistx.com");
    const args = await calls();
    expect(args).toContain("--ssl-reqd");
    // The login reaches curl on stdin, never on its argument list.
    expect(args).not.toContain("s3cret");
    expect(args).not.toContain("--user");
    expect(args).toContain("-K -");
    // curl decodes the percent-encoded login itself.
    expect(await readFile(join(root, "curl-config"), "utf8")).toBe(
      'url = "smtp://no-reply%40softistx.com:s3cret@mail.softistx.com:587"\n',
    );
    expect(args).toContain("--connect-to mail.softistx.com:587:bumail:587");
    expect(args).toContain("--mail-from no-reply@softistx.com");
    expect(args).toContain("--mail-rcpt ops@softistx.com");
    const message = await sent();
    expect(message).toContain("From: no-reply@softistx.com\r\n");
    expect(message).toContain("To: ops@softistx.com\r\n");
    expect(message).toContain("Subject: [storix] backup FAILED\r\n");
    expect(message).toContain("exit 1");
    // Every line ends in CRLF: no bare LF.
    expect(message.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("the subject carries the offsite prefix of the stack", async () => {
    await run(["failed", "x"], { ...mail, BACKUP_S3_PREFIX: "storix-demo" });
    expect(await sent()).toContain("Subject: [storix-demo] backup FAILED\r\n");
  });

  test("a quote or backslash in the URL is escaped for curl's config", async () => {
    await run(["failed", "x"], {
      ...mail,
      MAIL_URL: 'smtp://u:a"b\\c@bumail:587',
    });
    expect(await readFile(join(root, "curl-config"), "utf8")).toBe(
      'url = "smtp://u:a\\"b\\\\c@bumail:587"\n',
    );
  });

  test("port 465 and smtps are implicit TLS; other ports are smtp with STARTTLS", async () => {
    await run(["failed", "x"], {
      ...mail,
      MAIL_URL: "smtp://u:p@mail.example.com:465",
    });
    let args = await calls();
    expect(await readFile(join(root, "curl-config"), "utf8")).toContain(
      'url = "smtps://u:p@mail.example.com:465"',
    );
    expect(args).not.toContain("--ssl-reqd");
    await rm(join(root, "curl-args"));
    await run(["failed", "x"], {
      ...mail,
      MAIL_URL: "smtps://u:p@mail.example.com",
    });
    args = await calls();
    expect(await readFile(join(root, "curl-config"), "utf8")).toContain(
      'url = "smtps://u:p@mail.example.com:465"',
    );
    expect(args).not.toContain("--ssl-reqd");
  });

  test("without a login (a local relay) the session is plain, on the default port", async () => {
    await run(["failed", "x"], { ...mail, MAIL_URL: "smtp://mailpit:1025" });
    const args = await calls();
    expect(args).not.toContain("--ssl-reqd");
    expect(await readFile(join(root, "curl-config"), "utf8")).toBe(
      'url = "smtp://mailpit:1025"\n',
    );
    await rm(join(root, "curl-args"));
    await run(["failed", "x"], { ...mail, MAIL_URL: "smtp://mailpit" });
    expect(await readFile(join(root, "curl-config"), "utf8")).toBe(
      'url = "smtp://mailpit:587"\n',
    );
  });

  test("a mail that cannot leave never fails the caller", async () => {
    const { code, err } = await run(["failed", "x"], {
      ...mail,
      CURL_FAIL: "1",
    });
    expect(code).toBe(0);
    expect(err).toContain("could not mail ops@softistx.com");
  });

  test("a missing or non-smtp MAIL_URL is logged, not fatal", async () => {
    for (const MAIL_URL of ["", "http://x"]) {
      const { code, err } = await run(["failed", "x"], { ...mail, MAIL_URL });
      expect(code).toBe(0);
      expect(err).toContain("MAIL_URL (smtp:// or smtps://) is needed");
    }
  });

  test("a missing MAIL_FROM is logged, not fatal", async () => {
    const { code, err } = await run(["failed", "x"], {
      ...mail,
      MAIL_FROM: "",
    });
    expect(code).toBe(0);
    expect(err).toContain("MAIL_FROM is needed");
    expect(await calls()).toBe("");
  });

  test("check: a success under 26 h old sends nothing", async () => {
    await writeFile(join(backups, "last-success"), stamp(25 * 3600));
    await run(["check"], mail);
    expect(await calls()).toBe("");
  });

  test("check: older than 26 h mails once, then waits 24 h", async () => {
    await writeFile(join(backups, "last-success"), stamp(27 * 3600));
    await run(["check"], mail);
    expect(await sent()).toContain("Subject: [storix] backup is stale");
    await rm(join(root, "curl-args"));
    await run(["check"], mail);
    expect(await calls()).toBe("");
    // 25 h later it reminds again.
    await writeFile(join(backups, "last-alert"), stamp(25 * 3600));
    await run(["check"], mail);
    expect(await calls()).toContain("--mail-rcpt ops@softistx.com");
  });

  test("check: a fresh volume (no last-success) is measured from the first check, not from the epoch", async () => {
    await run(["check"], mail);
    expect(await calls()).toBe("");
    expect(await Bun.file(join(backups, "first-seen")).exists()).toBe(true);
    await writeFile(join(backups, "first-seen"), stamp(27 * 3600));
    await run(["check"], mail);
    expect(await calls()).toContain("--mail-rcpt ops@softistx.com");
  });

  test("check: a fresh backup clears last-alert, so a later outage mails again", async () => {
    await writeFile(join(backups, "last-success"), stamp(3600));
    await writeFile(join(backups, "last-alert"), stamp(3600));
    await run(["check"], mail);
    expect(await Bun.file(join(backups, "last-alert")).exists()).toBe(false);
  });

  test("check: a failed send does not record the alert, so the next hour retries", async () => {
    await writeFile(join(backups, "last-success"), stamp(30 * 3600));
    await run(["check"], { ...mail, CURL_FAIL: "1" });
    expect(await Bun.file(join(backups, "last-alert")).exists()).toBe(false);
  });

  test("an unknown mode is a usage error", async () => {
    const { code } = await run(["bogus"], mail);
    expect(code).toBe(2);
  });
});
