import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { harness } from "./identity.harness";

const withKey = (token: string, path = "/graphql") =>
  new Request(`http://localhost${path}`, {
    method: path === "/graphql" ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "x-storix-client": "spec" },
  });

describe("API keys", () => {
  test("a key authenticates only where the call asks for it", async () => {
    const h = await harness();
    const user = await h.account();
    const key = await h.apiKey(user);
    expect(key.startsWith("stx_")).toBe(true);
    expect(await h.identity.authenticate(withKey(key))).toBeNull();
    const principal = await h.identity.authenticate(withKey(key), {
      apiKey: true,
    });
    expect(principal).toMatchObject({
      accountId: user.principal.accountId,
      sessionId: null,
      authenticatedAt: null,
      sessionExpiresAt: null,
    });
    expect(principal?.apiKeyId).toBeTruthy();
    // A key is never fresh.
    if (principal) expect(() => h.identity.assertFresh(principal)).toThrow();
  });

  test("a revoked or unknown key is anonymous", async () => {
    const h = await harness();
    expect(
      await h.identity.authenticate(withKey("stx_unknown_unknown"), {
        apiKey: true,
      }),
    ).toBeNull();
  });

  test("/graphql answers the viewer of a key, with its apiKeyId and no session", async () => {
    const h = await harness();
    const key = await h.apiKey(await h.account());
    const result = await h.client.query<{ viewer: Record<string, unknown> }>(
      "{ viewer { apiKeyId sessionExpiresAt sessionConfirmedUntil } }",
      { headers: { authorization: `Bearer ${key}` } },
    );
    expect(result.data?.viewer["apiKeyId"]).toBeTruthy();
    expect(result.data?.viewer["sessionExpiresAt"]).toBeNull();
    expect(result.data?.viewer["sessionConfirmedUntil"]).toBeNull();
  });

  // Every operation of the account is refused to a key, with a real key
  // authenticated by the viewer middleware (never a hand-built principal).
  const operations: [string, string][] = [
    ["secondFactorStatus", "{ secondFactorStatus { enabled } }"],
    [
      "signUp",
      'mutation { signUp(input: { email: "a@b.test", name: "A", locale: EN }) { status } }',
    ],
    [
      "completeSignUp",
      'mutation { completeSignUp(token: "t", password: "long enough password") { status } }',
    ],
    [
      "signIn",
      'mutation { signIn(input: { email: "a@b.test", password: "x" }) { status } }',
    ],
    [
      "confirmSecondFactor",
      'mutation { confirmSecondFactor(challenge: "c", code: "123456") { status } }',
    ],
    [
      "recoverSecondFactor",
      'mutation { recoverSecondFactor(challenge: "c", recoveryCode: "abc") { status } }',
    ],
    ["signOut", "mutation { signOut }"],
    [
      "requestPasswordReset",
      'mutation { requestPasswordReset(email: "a@b.test") }',
    ],
    [
      "resetPassword",
      'mutation { resetPassword(token: "t", password: "long enough password") }',
    ],
    ["requestStepUp", "mutation { requestStepUp { method } }"],
    [
      "confirmStepUp",
      'mutation { confirmStepUp(challenge: "c", code: "123456") }',
    ],
    ["enrolSecondFactor", "mutation { enrolSecondFactor { secret } }"],
    [
      "activateSecondFactor",
      'mutation { activateSecondFactor(code: "123456") { recoveryCodes } }',
    ],
    [
      "regenerateRecoveryCodes",
      'mutation { regenerateRecoveryCodes(code: "123456") { recoveryCodes } }',
    ],
    ["disableSecondFactor", 'mutation { disableSecondFactor(code: "123456") }'],
  ];
  for (const [name, query] of operations) {
    test(`${name} refuses a key: 401 api-key-not-accepted`, async () => {
      const h = await harness();
      const key = await h.apiKey(await h.account());
      const result = await h.client.query(query, {
        headers: { authorization: `Bearer ${key}` },
      });
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "auth.errors.api-key-not-accepted",
      );
      expect(result.response.status).toBe(401);
    });
  }

  test("a key-shaped bearer off the key paths is 401 api-key-not-accepted", async () => {
    const h = await harness();
    const key = await h.apiKey(await h.account());
    for (const path of ["/", "/admin", "/auth/anything", "/graphqlx"]) {
      const response = await h.app.fetch(withKey(key, path));
      expect(response.status).toBe(401);
      const body = (await response.json()) as {
        errors: { extensions: { code: string } }[];
      };
      expect(body.errors[0]?.extensions.code).toBe(
        "auth.errors.api-key-not-accepted",
      );
    }
  });

  test("a revoked or unknown key off the key paths is refused the same way", async () => {
    const h = await harness();
    const user = await h.account();
    const key = await h.apiKey(user);
    // Revoke it: its owner signs every key out.
    await h.revokeKeys(user);
    for (const token of [key, "stx_unknown_unknown"]) {
      for (const path of ["/admin", "/media-x", "/"]) {
        const response = await h.app.fetch(withKey(token, path));
        expect(response.status).toBe(401);
        const body = (await response.json()) as {
          errors: { extensions: { code: string } }[];
        };
        expect(body.errors[0]?.extensions.code).toBe(
          "auth.errors.api-key-not-accepted",
        );
      }
    }
  });

  test("/media accepts a key-shaped bearer, valid or not (the route decides)", async () => {
    const h = await harness();
    for (const token of [
      await h.apiKey(await h.account()),
      "stx_unknown_unknown",
    ]) {
      const response = await h.app.fetch(withKey(token, "/media"));
      const body = await response.text();
      expect(body).not.toContain("api-key-not-accepted");
    }
  });

  test("a key is accepted on /graphql, /health and /ready; a session is accepted anywhere", async () => {
    const h = await harness();
    const user = await h.account();
    const key = await h.apiKey(user);
    for (const path of ["/health", "/ready", "/graphql"]) {
      const response = await h.app.fetch(withKey(key, path));
      expect(response.status).not.toBe(401);
    }
    const session = await h.app.fetch(withKey(user.token, "/nowhere"));
    expect(session.status).toBe(404);
  });
});

describe("the store is down", () => {
  test("authenticate answers 503 identity.errors.unavailable, never anonymous", async () => {
    const dead = new MongoClient("mongodb://127.0.0.1:1", {
      serverSelectionTimeoutMS: 200,
    });
    const h = await harness({ db: dead.db("down") });
    const response = await h.app.fetch(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          authorization: "Bearer some-session-token",
          "x-storix-client": "spec",
        },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      errors: { extensions: { code: string } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe("identity.errors.unavailable");
    await dead.close();
  });
});
