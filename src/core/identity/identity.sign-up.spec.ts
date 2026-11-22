import { describe, expect, test } from "bun:test";
import { harness, PASSWORD } from "./identity.harness";
import { codeOf, refusal } from "./identity.refusals";

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
