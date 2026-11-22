import { describe, expect, test } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness } from "./identity.harness";
import { codeOf, refusal } from "./identity.refusals";
import {
  FRESH,
  STEP,
  withSecondFactor,
} from "./identity.second-factor.harness";

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

describe("recovery codes through disableSecondFactor", () => {
  const asRequest = (token: string) =>
    new Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    });

  test("a wrong code is refused as invalid with attemptsLeft", async () => {
    const { h, user } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    const error = (await refusal(
      h.identity.disableSecondFactor(
        asRequest(user.token),
        principal,
        "WRONG-0",
      ),
    )) as { extensions: Record<string, unknown> };
    expect(codeOf(error)).toBe("identity.errors.second-factor-invalid");
    expect(error.extensions["attemptsLeft"]).toBe(4);
  });

  test("the right code turns the factor off, opens no session and sends no notice", async () => {
    const { h, user, recoveryCodes } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    await h.identity.settled();
    const mailsBefore = h.mailsTo(user.email).length;
    expect(
      await h.identity.disableSecondFactor(
        asRequest(user.token),
        principal,
        recoveryCodes[0] ?? "",
      ),
    ).toBe(true);
    await h.identity.settled();
    expect((await h.identity.secondFactorStatus(principal)).enabled).toBe(
      false,
    );
    // The only mail is the notice that the factor is off: no sign-in notice.
    expect(
      h
        .mailsTo(user.email)
        .slice(mailsBefore)
        .map((mail) => mail.subject),
    ).toEqual(["Two-factor authentication was turned off"]);
    // Only the account's own session exists: nothing was opened or ended.
    expect(await h.identity.authenticate(asRequest(user.token))).not.toBeNull();
  });

  test("after five wrong tries every further one is rate limited", async () => {
    const { h, user, recoveryCodes } = await withSecondFactor();
    const principal = { ...user.principal, secondFactor: true };
    const request = asRequest(user.token);
    for (let i = 0; i < 5; i++) {
      expect(
        codeOf(
          await refusal(
            h.identity.disableSecondFactor(request, principal, `WRONG-${i}`),
          ),
        ),
      ).toBe("identity.errors.second-factor-invalid");
    }
    expect(
      codeOf(
        await refusal(
          h.identity.disableSecondFactor(
            request,
            principal,
            recoveryCodes[0] ?? "",
          ),
        ),
      ),
    ).toBe("auth.errors.rate-limited");
  });
});
