import { describe, expect, test } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness, PASSWORD } from "./identity.harness";
import { codeOf, refusal } from "./identity.refusals";
import {
  FRESH,
  STEP,
  withSecondFactor,
} from "./identity.second-factor.harness";

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
