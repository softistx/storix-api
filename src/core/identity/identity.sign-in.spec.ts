import { describe, expect, test } from "bun:test";
import { harness, PASSWORD } from "./identity.harness";
import { codeOf, refusal } from "./identity.refusals";

describe("sign-in and sign-out", () => {
  test("signs in with the password and out again", async () => {
    const h = await harness();
    const { email } = await h.account();
    const result = await h.identity.signIn({ email, password: PASSWORD });
    if (result.status !== "SIGNED_IN") throw new Error("not signed in");
    const request = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${result.token}` },
    });
    expect((await h.identity.authenticate(request))?.email).toBe(email);
    expect(await h.identity.signOut(request)).toBe(true);
    expect(await h.identity.authenticate(request)).toBeNull();
  });

  test("a wrong password and an unknown address are one refusal", async () => {
    const h = await harness();
    const { email } = await h.account();
    const wrong = await refusal(
      h.identity.signIn({ email, password: "wrong password!" }),
    );
    const unknown = await refusal(
      h.identity.signIn({ email: h.email(), password: "wrong password!" }),
    );
    expect(codeOf(wrong)).toBe("identity.errors.invalid-credentials");
    expect(codeOf(unknown)).toBe("identity.errors.invalid-credentials");
    expect(wrong.extensions["http"]).toEqual({ status: 401 });
  });

  test("a deactivated account is refused as a wrong password is", async () => {
    const h = await harness();
    const { email, principal } = await h.account();
    await h.deactivate(principal.accountId);
    const error = await refusal(
      h.identity.signIn({ email, password: PASSWORD }),
    );
    expect(codeOf(error)).toBe("identity.errors.invalid-credentials");
  });

  test("repeated wrong passwords are throttled, 429 rate-limited", async () => {
    const h = await harness();
    const { email } = await h.account();
    let last: unknown;
    for (let i = 0; i < 30; i++) {
      last = await refusal(
        h.identity.signIn({ email, password: "wrong password!" }),
      );
      if (codeOf(last) === "auth.errors.rate-limited") break;
    }
    expect(codeOf(last)).toBe("auth.errors.rate-limited");
    expect(
      (last as { extensions: Record<string, unknown> }).extensions["http"],
    ).toEqual({
      status: 429,
    });
  });

  test("a request with no credential is anonymous", async () => {
    const h = await harness();
    expect(await h.identity.authenticate(h.request())).toBeNull();
  });
});

describe("password reset", () => {
  test("mails a link, sets the new password and ends the old sessions", async () => {
    const h = await harness();
    const { email, token } = await h.account();
    expect(await h.identity.requestPasswordReset(h.request(), email)).toBe(
      true,
    );
    await h.identity.settled();
    const link = h.tokenFor(email);
    expect(await h.identity.resetPassword(link, "a brand new password")).toBe(
      true,
    );
    const old = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await h.identity.authenticate(old)).toBeNull();
    const result = await h.identity.signIn({
      email,
      password: "a brand new password",
    });
    expect(result.status).toBe("SIGNED_IN");
    expect(
      codeOf(
        await refusal(h.identity.resetPassword(link, "yet another password")),
      ),
    ).toBe("identity.errors.token-invalid");
  });

  test("answers true for an unknown address and sends nothing", async () => {
    const h = await harness();
    const address = h.email();
    expect(await h.identity.requestPasswordReset(h.request(), address)).toBe(
      true,
    );
    await h.identity.settled();
    expect(h.mailsTo(address)).toEqual([]);
  });

  test("refuses a short new password", async () => {
    const h = await harness();
    const { email } = await h.account();
    await h.identity.requestPasswordReset(h.request(), email);
    await h.identity.settled();
    const error = await refusal(
      h.identity.resetPassword(h.tokenFor(email), "short"),
    );
    expect(codeOf(error)).toBe("validation.errors.invalid-input");
  });

  test("past the mail throttle, answers 429 rate-limited", async () => {
    const h = await harness({
      mail: { throttle: { attempts: 3, window: "10m" } },
    });
    const { email } = await h.account();
    await h.identity.requestPasswordReset(h.request(), email);
    await h.identity.requestPasswordReset(h.request(), email);
    const error = await refusal(
      h.identity.requestPasswordReset(h.request(), email),
    );
    await h.identity.settled();
    expect(codeOf(error)).toBe("auth.errors.rate-limited");
    expect(error.extensions["http"]).toEqual({ status: 429 });
  });
});
