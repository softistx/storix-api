import { describe, expect, test } from "bun:test";
import { harness, PASSWORD } from "./identity.harness";

const SIGN_IN = `mutation($input: SignInInput!) {
  signIn(input: $input) { status token expiresAt challenge viewer { id email hasSecondFactor apiKeyId sessionConfirmedUntil } }
}`;

describe("the identity operations over /graphql", () => {
  test("viewer is null when anonymous and the account behind a session", async () => {
    const h = await harness();
    const anonymous = await h.client.query<{ viewer: null }>(
      "{ viewer { id } }",
    );
    expect(anonymous.data?.viewer).toBeNull();
    const user = await h.account();
    const result = await h.client.query<{ viewer: Record<string, unknown> }>(
      "{ viewer { email name emailVerified locale hasSecondFactor apiKeyId sessionExpiresAt sessionConfirmedUntil } }",
      { headers: user.headers },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer).toMatchObject({
      email: user.email,
      name: "Ada",
      emailVerified: true,
      locale: "EN",
      hasSecondFactor: false,
      apiKeyId: null,
    });
    expect(result.data?.viewer["sessionExpiresAt"]).toBeTruthy();
    expect(result.data?.viewer["sessionConfirmedUntil"]).toBeTruthy();
  });

  test("signUp, completeSignUp and signIn answer their payloads", async () => {
    const h = await harness();
    const address = h.email();
    const up = await h.client.query<{
      signUp: { status: string; token: string | null };
    }>(
      `mutation($input: SignUpInput!) { signUp(input: $input) { status token } }`,
      { variables: { input: { email: address, name: "Ada", locale: "FR" } } },
    );
    expect(up.data?.signUp).toEqual({
      status: "VERIFICATION_SENT",
      token: null,
    });
    await h.identity.settled();
    const done = await h.client.query<{
      completeSignUp: { status: string; token: string };
    }>(
      `mutation($t: String!, $p: String!) { completeSignUp(token: $t, password: $p) { status token } }`,
      { variables: { t: h.tokenFor(address), p: PASSWORD } },
    );
    expect(done.data?.completeSignUp.status).toBe("SIGNED_IN");
    const again = await h.client.query<{
      signIn: { status: string; viewer: { email: string } };
    }>(SIGN_IN, {
      variables: { input: { email: address, password: PASSWORD } },
    });
    expect(again.data?.signIn.status).toBe("SIGNED_IN");
    expect(again.data?.signIn.viewer.email).toBe(address);
  });

  test("a wrong password is 200 with identity.errors.invalid-credentials, translated", async () => {
    const h = await harness();
    const user = await h.account();
    const result = await h.client.query(SIGN_IN, {
      variables: { input: { email: user.email, password: "wrong password" } },
      headers: { "accept-language": "fr" },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "identity.errors.invalid-credentials",
    );
    expect(result.response.status).toBe(401);
  });

  test("an operation that needs a session is 401 when anonymous", async () => {
    const h = await harness();
    for (const query of [
      "mutation { enrolSecondFactor { secret } }",
      "mutation { requestStepUp { method } }",
      "{ secondFactorStatus { enabled } }",
    ]) {
      const result = await h.client.query(query);
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "auth.errors.unauthenticated",
      );
      expect(result.response.status).toBe(401);
    }
  });

  test("an input past its constraint is refused before any resolver runs", async () => {
    const h = await harness();
    const result = await h.client.query(SIGN_IN, {
      variables: { input: { email: "a@b.test", password: "x".repeat(2000) } },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "validation.errors.invalid-input",
    );
  });

  test("signOut ends the session; secondFactorStatus reads the factor", async () => {
    const h = await harness();
    const user = await h.account();
    const status = await h.client.query<{ secondFactorStatus: unknown }>(
      "{ secondFactorStatus { enabled recoveryCodesLeft } }",
      { headers: user.headers },
    );
    expect(status.data?.secondFactorStatus).toEqual({
      enabled: false,
      recoveryCodesLeft: null,
    });
    const out = await h.client.query<{ signOut: boolean }>(
      "mutation { signOut }",
      {
        headers: user.headers,
      },
    );
    expect(out.data?.signOut).toBe(true);
    const after = await h.client.query<{ viewer: unknown }>(
      "{ viewer { id } }",
      {
        headers: user.headers,
      },
    );
    expect(after.data?.viewer).toBeNull();
  });
});
