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

  test("a key may not step up, enrol or sign out like a session", async () => {
    const h = await harness();
    const key = await h.apiKey(await h.account());
    const result = await h.client.query(
      "mutation { enrolSecondFactor { secret } }",
      {
        headers: { authorization: `Bearer ${key}` },
      },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.step-up-required",
    );
  });

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
