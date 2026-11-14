import { describe, expect, test } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness, PASSWORD } from "./identity.harness";

const codeOf = (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code;
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { extensions: Record<string, unknown> };
  }
  throw new Error("not refused");
};
const STEP = 31_000;
const FRESH = 10 * 60 * 1000;

// An account with an active second factor: its secret, recovery codes and the
// session that activated it.
async function withSecondFactor() {
  const h = await harness();
  const user = await h.account();
  const { secret, uri } = await h.identity.enrolSecondFactor(user.principal);
  expect(uri.startsWith("otpauth://")).toBe(true);
  const { recoveryCodes } = await h.identity.activateSecondFactor(
    user.principal,
    totpCode(secret, h.clock.now()),
  );
  const bearer = (token: string) =>
    new Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    });
  return { h, user, secret, recoveryCodes, bearer };
}

describe("enrolling and activating", () => {
  test("activating answers ten recovery codes and ends the other sessions", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (other.status !== "SIGNED_IN") throw new Error("not signed in");
    const { secret } = await h.identity.enrolSecondFactor(user.principal);
    const { recoveryCodes } = await h.identity.activateSecondFactor(
      user.principal,
      totpCode(secret, h.clock.now()),
    );
    expect(recoveryCodes).toHaveLength(10);
    const otherRequest = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(await h.identity.authenticate(otherRequest)).toBeNull();
    const own = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect((await h.identity.authenticate(own))?.secondFactor).toBe(true);
    expect(
      await h.identity.secondFactorStatus({
        ...user.principal,
        secondFactor: true,
      }),
    ).toEqual({
      enabled: true,
      recoveryCodesLeft: 10,
    });
  });

  test("refuses an unverified address, a stale session and a key", async () => {
    const h = await harness();
    const user = await h.account();
    const unverified = { ...user.principal, emailVerified: false };
    expect(
      codeOf(await refusal(h.identity.enrolSecondFactor(unverified))),
    ).toBe("identity.errors.email-unverified");
    const key = {
      ...user.principal,
      authenticatedAt: null,
      sessionId: null,
      apiKeyId: "key",
    };
    expect(codeOf(await refusal(h.identity.enrolSecondFactor(key)))).toBe(
      "auth.errors.step-up-required",
    );
    h.clock.advance(FRESH + 1000);
    const error = await refusal(h.identity.enrolSecondFactor(user.principal));
    expect(codeOf(error)).toBe("auth.errors.step-up-required");
    expect(error.extensions["http"]).toEqual({ status: 403 });
  });

  test("a wrong first code is refused and the factor stays off", async () => {
    const h = await harness();
    const user = await h.account();
    await h.identity.enrolSecondFactor(user.principal);
    const error = await refusal(
      h.identity.activateSecondFactor(user.principal, "000000"),
    );
    expect(codeOf(error)).toBe("identity.errors.second-factor-invalid");
    expect(await h.identity.secondFactorStatus(user.principal)).toEqual({
      enabled: false,
      recoveryCodesLeft: null,
    });
  });

  test("activating before enrolling, and enrolling twice, are refused as a state", async () => {
    const h = await harness();
    const user = await h.account();
    expect(
      codeOf(
        await refusal(
          h.identity.activateSecondFactor(user.principal, "123456"),
        ),
      ),
    ).toBe("identity.errors.second-factor-state");
    const { h: active, user: owner } = await withSecondFactor();
    expect(
      codeOf(await refusal(active.identity.enrolSecondFactor(owner.principal))),
    ).toBe("identity.errors.second-factor-state");
  });
});

describe("signing in with a second factor", () => {
  test("asks for a code, then signs in with the app's code", async () => {
    const { h, user, secret } = await withSecondFactor();
    const first = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (first.status !== "SECOND_FACTOR") throw new Error("no challenge");
    h.clock.advance(STEP);
    const wrong = await refusal(
      h.identity.confirmSecondFactor(first.challenge, "000000"),
    );
    expect(codeOf(wrong)).toBe("identity.errors.second-factor-invalid");
    expect(wrong.extensions["attemptsLeft"]).toBeGreaterThan(0);
    const done = await h.identity.confirmSecondFactor(
      first.challenge,
      totpCode(secret, h.clock.now()),
    );
    expect(done.status).toBe("SIGNED_IN");
  });

  test("a code that was used is refused again", async () => {
    const { h, user, secret } = await withSecondFactor();
    h.clock.advance(STEP);
    const code = totpCode(secret, h.clock.now());
    const first = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (first.status !== "SECOND_FACTOR") throw new Error("no challenge");
    await h.identity.confirmSecondFactor(first.challenge, code);
    const second = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (second.status !== "SECOND_FACTOR") throw new Error("no challenge");
    expect(
      codeOf(
        await refusal(h.identity.confirmSecondFactor(second.challenge, code)),
      ),
    ).toBe("identity.errors.second-factor-invalid");
  });

  test("a recovery code works once", async () => {
    const { h, user, recoveryCodes } = await withSecondFactor();
    const recovery = recoveryCodes[0] ?? "";
    const first = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (first.status !== "SECOND_FACTOR") throw new Error("no challenge");
    expect(
      (await h.identity.recoverSecondFactor(first.challenge, recovery)).status,
    ).toBe("SIGNED_IN");
    const second = await h.identity.signIn({
      email: user.email,
      password: PASSWORD,
    });
    if (second.status !== "SECOND_FACTOR") throw new Error("no challenge");
    expect(
      codeOf(
        await refusal(
          h.identity.recoverSecondFactor(second.challenge, recovery),
        ),
      ),
    ).toBe("identity.errors.second-factor-invalid");
  });

  test("an unknown challenge is a token refusal", async () => {
    const h = await harness();
    expect(
      codeOf(await refusal(h.identity.confirmSecondFactor("nope", "123456"))),
    ).toBe("identity.errors.token-invalid");
  });
});

describe("regenerating and disabling", () => {
  test("regenerating answers ten new codes and ends the old ones", async () => {
    const { h, user, secret, recoveryCodes } = await withSecondFactor();
    h.clock.advance(STEP);
    const fresh = await h.identity.regenerateRecoveryCodes(
      user.principal,
      totpCode(secret, h.clock.now()),
    );
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect(fresh.recoveryCodes).not.toContain(recoveryCodes[0]);
  });

  test("disabling needs a current code and a fresh session", async () => {
    const { h, user, secret } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    h.clock.advance(STEP);
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(request, principal, "000000"),
        ),
      ),
    ).toBe("identity.errors.second-factor-invalid");
    expect(
      await h.identity.disableSecondFactor(
        request,
        principal,
        totpCode(secret, h.clock.now()),
      ),
    ).toBe(true);
    expect((await h.identity.secondFactorStatus(principal)).enabled).toBe(
      false,
    );
    h.clock.advance(FRESH);
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(request, principal, "123456"),
        ),
      ),
    ).toBe("auth.errors.step-up-required");
  });
});

describe("a lost authenticator", () => {
  test("lost phone: recover, disable, enrol again", async () => {
    const { h, user, recoveryCodes } = await withSecondFactor();
    const email = user.email;
    const started = await h.identity.signIn({ email, password: PASSWORD });
    if (started.status !== "SECOND_FACTOR") throw new Error("no challenge");
    const recovered = await h.identity.recoverSecondFactor(
      started.challenge,
      recoveryCodes[0] ?? "",
    );
    if (recovered.status !== "SIGNED_IN") throw new Error("not signed in");
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${recovered.token}` },
    });
    // The session is fresh from its sign-in: a recovery code disables the
    // factor. A wrong one, and a spent one, are refused.
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(
            request,
            recovered.principal,
            "WRONG-CODE",
          ),
        ),
      ),
    ).toBe("identity.errors.second-factor-invalid");
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(
            request,
            recovered.principal,
            recoveryCodes[0] ?? "",
          ),
        ),
      ),
    ).toBe("identity.errors.second-factor-invalid");
    expect(
      await h.identity.disableSecondFactor(
        request,
        recovered.principal,
        recoveryCodes[1] ?? "",
      ),
    ).toBe(true);
    expect(
      (await h.identity.secondFactorStatus(recovered.principal)).enabled,
    ).toBe(false);
    // The session the recovery opened for the check ended with it: the
    // account's own session still works.
    expect(await h.identity.authenticate(request)).not.toBeNull();
    // A new phone: enrol and activate again.
    const again = await h.identity.enrolSecondFactor(recovered.principal);
    h.clock.advance(STEP);
    const fresh = await h.identity.activateSecondFactor(
      recovered.principal,
      totpCode(again.secret, h.clock.now()),
    );
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect(
      (await h.identity.secondFactorStatus(recovered.principal)).enabled,
    ).toBe(true);
  });

  test("a recovery code does not disable a factor on a stale session", async () => {
    const { h, user, recoveryCodes } = await withSecondFactor();
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    h.clock.advance(FRESH);
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(
            request,
            { ...user.principal, secondFactor: true },
            recoveryCodes[0] ?? "",
          ),
        ),
      ),
    ).toBe("auth.errors.step-up-required");
  });
});

describe("step-up", () => {
  test("past the mail throttle, requesting a step-up code answers 429", async () => {
    const h = await harness({
      mail: { throttle: { attempts: 3, window: "10m" } },
    });
    const user = await h.account();
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    let last: unknown;
    for (let i = 0; i < 8; i++) {
      try {
        await h.identity.requestStepUp(request, user.principal);
      } catch (error) {
        last = error;
        break;
      }
    }
    await h.identity.settled();
    expect(codeOf(last)).toBe("auth.errors.rate-limited");
    expect(
      (last as { extensions: Record<string, unknown> }).extensions["http"],
    ).toEqual({ status: 429 });
  });

  test("an account without a factor is mailed a code, which makes the session fresh", async () => {
    const h = await harness();
    const user = await h.account();
    const request = new Request("http://localhost/", {
      headers: {
        authorization: `Bearer ${user.token}`,
        "accept-language": "fr",
      },
    });
    h.clock.advance(FRESH + 1000);
    expect(() => h.identity.assertFresh(user.principal)).toThrow();
    const challenge = await h.identity.requestStepUp(request, user.principal);
    expect(challenge.method).toBe("EMAIL");
    await h.identity.settled();
    const until = await h.identity.confirmStepUp(
      request,
      user.principal,
      challenge.challenge,
      h.codeFor(user.email),
    );
    expect(until.getTime()).toBe(h.clock.now().getTime() + FRESH);
    const refreshed = await h.identity.authenticate(request);
    expect(refreshed).not.toBeNull();
    if (refreshed)
      expect(() => h.identity.assertFresh(refreshed)).not.toThrow();
  });

  test("an account with a factor confirms with the app's code; a wrong one is refused", async () => {
    const { h, user, secret, bearer } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    const request = bearer(user.token);
    h.clock.advance(STEP);
    const challenge = await h.identity.requestStepUp(request, principal);
    expect(challenge.method).toBe("AUTHENTICATOR");
    expect(
      codeOf(
        await refusal(
          h.identity.confirmStepUp(
            request,
            principal,
            challenge.challenge,
            "000000",
          ),
        ),
      ),
    ).toBe("identity.errors.second-factor-invalid");
    await h.identity.confirmStepUp(
      request,
      principal,
      challenge.challenge,
      totpCode(secret, h.clock.now()),
    );
  });

  test("an API key principal is never fresh", async () => {
    const h = await harness();
    const user = await h.account();
    const key = {
      ...user.principal,
      authenticatedAt: null,
      sessionId: null,
      apiKeyId: "key",
    };
    expect(() => h.identity.assertFresh(key)).toThrow();
  });
});

describe("guessing recovery codes through disableSecondFactor", () => {
  // Temporary, until nxgt-janus#770: janus counts a recovery code's tries per
  // challenge, and each disableSecondFactor signs the account in afresh, so
  // janus alone never throttles them. The per-address limit in the resolver
  // does (rate-limits.spec.ts).
  test("ten wrong recovery codes in a row are each refused as invalid, janus does not throttle them", async () => {
    const { h, user } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    for (let i = 0; i < 10; i++) {
      expect(
        codeOf(
          await refusal(
            h.identity.disableSecondFactor(request, principal, `WRONG-${i}`),
          ),
        ),
      ).toBe("identity.errors.second-factor-invalid");
    }
  });
});
