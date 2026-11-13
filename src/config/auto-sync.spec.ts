import { describe, expect, test } from "bun:test";
import { autoSyncOf } from "./auto-sync";

describe("autoSyncOf", () => {
  test("is always on outside production", () => {
    expect(autoSyncOf(false, false)).toBe(true);
    expect(autoSyncOf(false, true)).toBe(true);
  });

  test("in production it follows MONGO_AUTO_SYNC", () => {
    expect(autoSyncOf(true, false)).toBe(false);
    expect(autoSyncOf(true, true)).toBe(true);
  });
});

// env.ts parses at import, so each case reads it in a process of its own.
const run = async (nodeEnv: string, flag?: string) => {
  const proc = Bun.spawn(
    ["bun", "-e", 'console.log((await import("./env")).env.MONGO_AUTO_SYNC)'],
    {
      cwd: import.meta.dir,
      env: {
        PATH: Bun.env["PATH"] ?? "",
        NODE_ENV: nodeEnv,
        MONGO_URI: "mongodb://localhost:27017",
        UI_ORIGIN: "https://storix.test",
        MAIL_FROM: "noreply@storix.test",
        MAIL_URL: "smtp://localhost:1025",
        TOTP_KEYS: "k:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        REDIS_URL: "redis://localhost:6379",
        API_PROXY_SECRET: "s".repeat(32),
        TRUSTED_PROXIES: "172.16.0.0/12",
        ...(flag === undefined ? {} : { MONGO_AUTO_SYNC: flag }),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = (await new Response(proc.stdout).text()).trim();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { out, err, code };
};
const parsed = async (nodeEnv: string, flag?: string) =>
  (await run(nodeEnv, flag)).out;

describe("MONGO_AUTO_SYNC in production", () => {
  test("is off when unset or empty", async () => {
    expect(await parsed("production")).toBe("false");
    expect(await parsed("production", "")).toBe("false");
  });

  test("is on for true, 1, yes and on, in any case", async () => {
    for (const on of ["true", "TRUE", "1", "yes", "on"])
      expect(await parsed("production", on)).toBe("true");
  });

  test("stays off for false", async () => {
    expect(await parsed("production", "false")).toBe("false");
  });

  test("an unknown value stops the process", async () => {
    const { out, err, code } = await run("production", "maybe");
    expect(code).not.toBe(0);
    expect(out).toBe("");
    expect(err).toContain("MONGO_AUTO_SYNC");
  });
});
