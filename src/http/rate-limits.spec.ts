import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { startTestRedis, type TestRedis } from "@softistx/redis/testing";
import { RedisClient } from "bun";
import { harness } from "@/core/identity/identity.harness";
import { createLimits, type LimitsConfig } from "./rate-limits";

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

describe("over /graphql", () => {
  const SIGN_UP = (email: string) =>
    `mutation { signUp(input: { email: "${email}", name: "A", locale: EN }) { status } }`;

  test("signUp past the limit is 429 rate-limited", async () => {
    const h = await harness({ limits: createLimits(client, config) });
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
    const h = await harness({ limits: createLimits(client, config) });
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
});
