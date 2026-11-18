import { describe, expect, test } from "bun:test";
import { harness, PASSWORD } from "./identity.harness";

const NEXT = "another long passphrase 42";

describe("the account security operations over /graphql", () => {
  test("sessions, changePassword and revokeOtherSessions", async () => {
    const h = await harness();
    const user = await h.account();
    h.clock.advance(1000);
    await h.identity.signIn(
      { email: user.email, password: PASSWORD },
      { deviceLabel: "Firefox on Linux" },
    );
    const list = await h.client.query<{
      sessions: { id: string; current: boolean; device: string | null }[];
    }>("{ sessions { id current device createdAt lastUsedAt expiresAt } }", {
      headers: user.headers,
    });
    expect(list.errors).toBeUndefined();
    expect(list.data?.sessions.map((s) => s.current)).toEqual([false, true]);

    const wrong = await h.client.query(
      "mutation($c: String!, $n: String!) { changePassword(current: $c, next: $n) }",
      { variables: { c: "nope nope nope", n: NEXT }, headers: user.headers },
    );
    expect(wrong.errors?.[0]?.extensions?.code).toBe(
      "identity.errors.current-password-wrong",
    );

    const revoked = await h.client.query<{ revokeOtherSessions: number }>(
      "mutation { revokeOtherSessions }",
      { headers: user.headers },
    );
    expect(revoked.data?.revokeOtherSessions).toBe(1);

    const changed = await h.client.query<{ changePassword: boolean }>(
      "mutation($c: String!, $n: String!) { changePassword(current: $c, next: $n) }",
      { variables: { c: PASSWORD, n: NEXT }, headers: user.headers },
    );
    expect(changed.data?.changePassword).toBe(true);
  });

  test("they need a session: anonymous is 401", async () => {
    const h = await harness();
    const result = await h.client.query("{ sessions { id } }");
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.unauthenticated",
    );
  });

  test("a personal API key is refused", async () => {
    const h = await harness();
    const user = await h.account();
    const key = await h.apiKey(user);
    const result = await h.client.query("{ sessions { id } }", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.api-key-not-accepted",
    );
  });
});
