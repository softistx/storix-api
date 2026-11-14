import { describe, expect, test } from "bun:test";
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

describe("sign-up", () => {
  test("opens an unverified account, mails the link and opens no session", async () => {
    const h = await harness();
    const address = h.email();
    const result = await h.identity.signUp({
      email: address,
      name: "Ada",
      locale: "fr",
    });
    await h.identity.settled();
    expect(result).toEqual({ status: "VERIFICATION_SENT" });
    expect(h.mailsTo(address).length).toBeGreaterThan(0);
    expect(h.tokenFor(address)).toBeTruthy();
    expect((await h.identity.accounts.byEmail(address))?.emailVerified).toBe(
      false,
    );
  });

  test("a taken address answers the same and creates nothing", async () => {
    const h = await harness();
    const { email } = await h.account();
    const before = h.mailsTo(email).length;
    const result = await h.identity.signUp({
      email,
      name: "Eve",
      locale: "en",
    });
    await h.identity.settled();
    expect(result).toEqual({ status: "VERIFICATION_SENT" });
    expect((await h.identity.accounts.byEmail(email))?.name).toBe("Ada");
    // The owner is warned, not told to verify.
    expect(h.mailsTo(email).length).toBeGreaterThan(before);
  });

  test("completeSignUp refuses a short password without spending the link", async () => {
    const h = await harness();
    const address = h.email();
    await h.identity.signUp({ email: address, name: "Ada", locale: "en" });
    await h.identity.settled();
    const token = h.tokenFor(address);
    const error = await refusal(h.identity.completeSignUp(token, "short"));
    expect(codeOf(error)).toBe("validation.errors.invalid-input");
    const result = await h.identity.completeSignUp(token, PASSWORD);
    expect(result.status).toBe("SIGNED_IN");
  });

  test("completeSignUp refuses an unknown token and a spent one", async () => {
    const h = await harness();
    const address = h.email();
    await h.identity.signUp({ email: address, name: "Ada", locale: "en" });
    await h.identity.settled();
    expect(
      codeOf(await refusal(h.identity.completeSignUp("nope", PASSWORD))),
    ).toBe("identity.errors.token-invalid");
    const token = h.tokenFor(address);
    await h.identity.completeSignUp(token, PASSWORD);
    expect(
      codeOf(await refusal(h.identity.completeSignUp(token, PASSWORD))),
    ).toBe("identity.errors.token-invalid");
  });

  test("the verification mail does not carry the name the caller gave", async () => {
    const h = await harness();
    const address = h.email();
    await h.identity.signUp({
      email: address,
      name: "Click here to win",
      locale: "en",
    });
    await h.identity.settled();
    const text = h.mailsTo(address)[0]?.text ?? "";
    expect(text).not.toContain("Click here to win");
    expect(text).toContain(address);
  });

  test("signing up again with an unverified address sends a fresh link in the account's language", async () => {
    const h = await harness();
    const address = h.email();
    await h.identity.signUp({ email: address, name: "Ada", locale: "fr" });
    await h.identity.settled();
    const first = h.mailsTo(address).length;
    const link = h.tokenFor(address);
    const again = await h.identity.signUp({
      email: address,
      name: "Someone else",
      locale: "en",
    });
    await h.identity.settled();
    expect(again).toEqual({ status: "VERIFICATION_SENT" });
    const mails = h.mailsTo(address);
    expect(mails.length).toBeGreaterThan(first);
    const resent = mails.at(-1);
    expect(resent?.subject).toBe(mails[0]?.subject);
    expect(resent?.text).toContain("token=");
    expect(h.tokenFor(address)).not.toBe(link);
    expect(resent?.text).not.toContain("Someone else");
  });

  test("signing up with a verified address mails its owner a notice and no link", async () => {
    const h = await harness();
    const { email } = await h.account();
    const before = h.mailsTo(email).length;
    const result = await h.identity.signUp({
      email,
      name: "Eve",
      locale: "en",
    });
    await h.identity.settled();
    expect(result).toEqual({ status: "VERIFICATION_SENT" });
    const notice = h.mailsTo(email).slice(before);
    expect(notice).toHaveLength(1);
    expect(notice[0]?.text).not.toContain("token=");
    expect(notice[0]?.text).toContain("An account already exists");
  });

  test("past the mail throttle, signUp still answers VERIFICATION_SENT for a free and a taken address", async () => {
    const h = await harness({
      mail: { throttle: { attempts: 1, window: "10m" } },
    });
    const taken = h.email();
    for (let i = 0; i < 4; i++) {
      expect(
        await h.identity.signUp({ email: taken, name: "Ada", locale: "en" }),
      ).toEqual({ status: "VERIFICATION_SENT" });
    }
    expect(
      await h.identity.signUp({ email: h.email(), name: "Bo", locale: "en" }),
    ).toEqual({ status: "VERIFICATION_SENT" });
    await h.identity.settled();
  });
});

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
