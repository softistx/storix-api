import { describe, expect, test } from "bun:test";
import { secondSession, standing } from "./identity.account-security.harness";
import { harness, PASSWORD } from "./identity.harness";
import { FRESH_FOR_MS } from "./identity.port";
import { codeOf, refusal } from "./identity.refusals";

const NEXT = "another long passphrase 42";

describe("changePassword", () => {
  test("sets the new password: the old one stops signing in", async () => {
    const h = await harness();
    const user = await h.account();
    expect(
      await h.identity.changePassword(user.principal, {
        current: PASSWORD,
        next: NEXT,
      }),
    ).toBe(true);
    expect(
      codeOf(
        await refusal(
          h.identity.signIn({ email: user.email, password: PASSWORD }),
        ),
      ),
    ).toBe("identity.errors.invalid-credentials");
    const result = await h.identity.signIn({
      email: user.email,
      password: NEXT,
    });
    expect(result.status).toBe("SIGNED_IN");
  });

  test("ends the account's other sessions and keeps the current one", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    await h.identity.changePassword(user.principal, {
      current: PASSWORD,
      next: NEXT,
    });
    expect(await standing(h, user.token)).not.toBeNull();
    expect(await standing(h, other.token)).toBeNull();
  });

  test("a wrong current password is refused and changes nothing", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    const error = await refusal(
      h.identity.changePassword(user.principal, {
        current: "not my password",
        next: NEXT,
      }),
    );
    expect(codeOf(error)).toBe("identity.errors.current-password-wrong");
    expect(error.extensions["http"]).toEqual({ status: 400 });
    // The old password still signs in, the new one does not, sessions stand.
    expect(
      (await h.identity.signIn({ email: user.email, password: PASSWORD }))
        .status,
    ).toBe("SIGNED_IN");
    expect(
      codeOf(
        await refusal(h.identity.signIn({ email: user.email, password: NEXT })),
      ),
    ).toBe("identity.errors.invalid-credentials");
    expect(await standing(h, other.token)).not.toBeNull();
  });

  test("a new password that is too short is refused with the field", async () => {
    const h = await harness();
    const user = await h.account();
    const error = await refusal(
      h.identity.changePassword(user.principal, {
        current: PASSWORD,
        next: "short",
      }),
    );
    expect(codeOf(error)).toBe("validation.errors.invalid-input");
    expect(
      (await h.identity.signIn({ email: user.email, password: PASSWORD }))
        .status,
    ).toBe("SIGNED_IN");
  });

  test("a session that is not fresh is refused with step-up-required and nothing changes", async () => {
    const h = await harness();
    const user = await h.account();
    h.clock.advance(FRESH_FOR_MS + 1000);
    const error = await refusal(
      h.identity.changePassword(user.principal, {
        current: PASSWORD,
        next: NEXT,
      }),
    );
    expect(codeOf(error)).toBe("auth.errors.step-up-required");
    expect(error.extensions["http"]).toEqual({ status: 403 });
    expect(
      (await h.identity.signIn({ email: user.email, password: PASSWORD }))
        .status,
    ).toBe("SIGNED_IN");
  });

  test("a step-up makes the session fresh again", async () => {
    const h = await harness();
    const user = await h.account();
    h.clock.advance(FRESH_FOR_MS + 1000);
    const request = h.request(user.headers);
    const challenge = await h.identity.requestStepUp(request, user.principal);
    await h.identity.settled();
    await h.identity.confirmStepUp(
      request,
      user.principal,
      challenge.challenge,
      h.codeFor(user.email),
    );
    const refreshed = await h.identity.authenticate(request);
    if (!refreshed) throw new Error("no session");
    expect(
      await h.identity.changePassword(refreshed, {
        current: PASSWORD,
        next: NEXT,
      }),
    ).toBe(true);
  });

  test("an API key is refused", async () => {
    const h = await harness();
    const user = await h.account();
    const key = {
      ...user.principal,
      authenticatedAt: null,
      sessionId: null,
      apiKeyId: "key",
    };
    expect(
      codeOf(
        await refusal(
          h.identity.changePassword(key, { current: PASSWORD, next: NEXT }),
        ),
      ),
    ).toBe("auth.errors.step-up-required");
  });
});
