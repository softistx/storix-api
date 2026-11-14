import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { startTestRedis, type TestRedis } from "@softistx/redis/testing";
import { RedisClient } from "bun";
import { redisOptions } from "@/config/redis-options";
import { harness } from "@/core/identity/identity.harness";
import {
  CHECK_TIMEOUT_MS,
  createLimits,
  type Limits,
  type LimitsConfig,
} from "./rate-limits";

// The three limits over a real Redis (a binary built once, cached in
// REDISMS_DOWNLOAD_DIR: docs/development.md).
let server: TestRedis;
let client: RedisClient;
beforeAll(async () => {
  server = await startTestRedis();
  client = new RedisClient(server.uri);
}, 300_000);
afterAll(async () => {
  client?.close();
  await server?.stop();
});
beforeEach(() => server.reset());

const window = { limit: 2, per: 60_000 };
const config: LimitsConfig = {
  signUp: window,
  signIn: window,
  passwordReset: window,
};
const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { extensions: Record<string, unknown> };
  }
  return undefined;
};

describe("createLimits", () => {
  test("past its window an address is refused 429 rate-limited, another address still passes", async () => {
    const limits = createLimits(client, config);
    await limits.signUp("203.0.113.1");
    await limits.signUp("203.0.113.1");
    const refused = await refusalOf(limits.signUp("203.0.113.1"));
    expect(refused?.extensions["code"]).toBe("auth.errors.rate-limited");
    expect(refused?.extensions["http"]).toEqual({ status: 429 });
    expect(Number(refused?.extensions["retryAfter"])).toBeGreaterThan(0);
    await limits.signUp("203.0.113.2");
  });

  test("each operation counts on its own", async () => {
    const limits = createLimits(client, config);
    await limits.signUp("203.0.113.1");
    await limits.signUp("203.0.113.1");
    await limits.signIn("203.0.113.1");
    await limits.passwordReset("203.0.113.1");
    expect(await refusalOf(limits.signUp("203.0.113.1"))).toBeDefined();
  });

  test("without Redis nothing is limited", async () => {
    const limits = createLimits(undefined, config);
    for (let i = 0; i < 10; i++) await limits.signIn("203.0.113.1");
  });

  test("a Redis that cannot answer lets the request through, logged", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const dead = new RedisClient("redis://127.0.0.1:1", {
      connectionTimeout: 200,
      autoReconnect: false,
    });
    const limits = createLimits(dead, config);
    await limits.signIn("203.0.113.1");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    dead.close();
  });
});

describe("a Redis outage fails open", () => {
  test("the production client options pass promptly once the server is stopped", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const own = await startTestRedis();
    const prod = new RedisClient(own.uri, redisOptions);
    const limits = createLimits(prod, config);
    await limits.signIn("203.0.113.1");
    await own.stop();
    const started = performance.now();
    for (let i = 0; i < 5; i++) await limits.signIn("203.0.113.1");
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    prod.close();
  }, 60_000);

  test("the production client options still count against a live server", async () => {
    const prod = new RedisClient(server.uri, redisOptions);
    const limits = createLimits(prod, config);
    await limits.signUp("203.0.113.9");
    await limits.signUp("203.0.113.9");
    expect(await refusalOf(limits.signUp("203.0.113.9"))).toBeDefined();
    prod.close();
  });

  test("a Redis that never answers is cut at the check timeout", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const silent = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, open() {} },
    });
    const stuck = new RedisClient(`redis://127.0.0.1:${silent.port}`);
    const limits = createLimits(stuck, config);
    const started = performance.now();
    await limits.signIn("203.0.113.1");
    expect(performance.now() - started).toBeLessThan(CHECK_TIMEOUT_MS + 1_500);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    stuck.close();
    silent.stop(true);
  }, 30_000);
});

describe("a request without an address", () => {
  test("is not limited, and logged once", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const limits = createLimits(client, config);
    for (let i = 0; i < 5; i++) await limits.signIn(undefined);
    expect(log).toHaveBeenCalledTimes(1);
    // Nothing was counted in a shared "unknown" bucket.
    await limits.signIn("unknown");
    await limits.signIn("unknown");
    log.mockRestore();
  });
});

// The in-process test app has no connection address; the limits see this one.
const atAddress = (inner: Limits, ip = "203.0.113.50"): Limits => ({
  signUp: () => inner.signUp(ip),
  signIn: () => inner.signIn(ip),
  passwordReset: () => inner.passwordReset(ip),
});

describe("over /graphql", () => {
  const SIGN_UP = (email: string) =>
    `mutation { signUp(input: { email: "${email}", name: "A", locale: EN }) { status } }`;

  test("signUp past the limit is 429 rate-limited", async () => {
    const h = await harness({
      limits: atAddress(createLimits(client, config)),
    });
    for (let i = 0; i < 2; i++) {
      const ok = await h.client.query(SIGN_UP(h.email()));
      expect(ok.errors).toBeUndefined();
    }
    const refused = await h.client.query(SIGN_UP(h.email()));
    expect(refused.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.rate-limited",
    );
    expect(refused.response.status).toBe(429);
  });

  test("signIn (and its second-factor codes) and requestPasswordReset past the limit are 429", async () => {
    const h = await harness({
      limits: atAddress(createLimits(client, config)),
    });
    const signIn = `mutation { signIn(input: { email: "x@storix.test", password: "wrong password" }) { status } }`;
    await h.client.query(signIn);
    await h.client.query(signIn);
    const third = await h.client.query(signIn);
    expect(third.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.rate-limited",
    );
    const confirm = await h.client.query(
      'mutation { confirmSecondFactor(challenge: "c", code: "123456") { status } }',
    );
    expect(confirm.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.rate-limited",
    );
    const reset = `mutation { requestPasswordReset(email: "x@storix.test") }`;
    await h.client.query(reset);
    await h.client.query(reset);
    const refused = await h.client.query(reset);
    expect(refused.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.rate-limited",
    );
    expect(refused.response.status).toBe(429);
  });

  test("disableSecondFactor with wrong recovery codes in a row is rate limited", async () => {
    const h = await harness({
      limits: atAddress(createLimits(client, config)),
    });
    const user = await h.account();
    const { secret } = await h.identity.enrolSecondFactor(user.principal);
    await h.identity.activateSecondFactor(
      user.principal,
      totpCode(secret, h.clock.now()),
    );
    const codes: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await h.client.query(
        `mutation { disableSecondFactor(code: "WRONG-${i}") }`,
        { headers: user.headers },
      );
      codes.push(result.errors?.[0]?.extensions?.code);
    }
    // janus itself never throttles a recovery code (each attempt signs in
    // afresh, so no challenge counts them): the per-address limit does.
    expect(codes.slice(0, 2)).toEqual([
      "identity.errors.second-factor-invalid",
      "identity.errors.second-factor-invalid",
    ]);
    expect(codes.slice(2)).toEqual(Array(8).fill("auth.errors.rate-limited"));
  });
});
