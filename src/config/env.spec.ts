import { describe, expect, test } from "bun:test";

// env.ts reads Bun.env once, at import: each case is a fresh process.
const SECRET = "s".repeat(32);
const base = {
  NODE_ENV: "production",
  MONGO_URI: "mongodb://localhost:27017",
  UI_ORIGIN: "https://storix.test",
  MAIL_FROM: "noreply@storix.test",
  MAIL_URL: "smtp://localhost:1025",
  REDIS_URL: "redis://localhost:6379",
  TRUSTED_PROXIES: "10.0.0.0/8",
  API_PROXY_SECRET: SECRET,
};

async function load(overrides: Record<string, string | undefined>) {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }
  const proc = Bun.spawn(
    ["bun", "--no-env-file", "-e", 'await import("./src/config/env")'],
    { cwd: `${import.meta.dir}/../..`, env, stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stderr };
}

describe("env in production", () => {
  test("a complete environment loads", async () => {
    expect((await load({})).code).toBe(0);
  });

  for (const name of [
    "UI_ORIGIN",
    "MAIL_FROM",
    "MAIL_URL",
    "REDIS_URL",
    "TRUSTED_PROXIES",
    "API_PROXY_SECRET",
  ]) {
    test(`${name} is required`, async () => {
      const { code, stderr } = await load({ [name]: undefined });
      expect(code).not.toBe(0);
      expect(stderr).toContain(name);
    });
  }

  test("API_PROXY_SECRET needs at least 32 characters", async () => {
    const short = await load({ API_PROXY_SECRET: "s".repeat(31) });
    expect(short.code).not.toBe(0);
    expect(short.stderr).toContain("at least 32 characters");
    expect((await load({ API_PROXY_SECRET: "s".repeat(32) })).code).toBe(0);
  });

  test("UI_ORIGIN must be https", async () => {
    const { code } = await load({ UI_ORIGIN: "http://storix.test" });
    expect(code).not.toBe(0);
  });

  test("an empty TRUSTED_PROXIES is unset, so refused", async () => {
    expect((await load({ TRUSTED_PROXIES: " , " })).code).not.toBe(0);
  });
});

describe("env outside production", () => {
  test("only MONGO_URI is required", async () => {
    const { code } = await load({
      NODE_ENV: "development",
      UI_ORIGIN: undefined,
      MAIL_FROM: undefined,
      MAIL_URL: undefined,
      REDIS_URL: undefined,
      TRUSTED_PROXIES: undefined,
      API_PROXY_SECRET: undefined,
    });
    expect(code).toBe(0);
  });

  test("a set API_PROXY_SECRET is still checked", async () => {
    const { code } = await load({
      NODE_ENV: "development",
      API_PROXY_SECRET: "short",
    });
    expect(code).not.toBe(0);
  });
});
