import { describe, expect, test } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness, PASSWORD } from "./identity.harness";
import { codeOf, refusal } from "./identity.refusals";
import {
  FRESH,
  STEP,
  withSecondFactor,
} from "./identity.second-factor.harness";

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
