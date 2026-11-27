import { describe, expect, test } from "bun:test";
import { buildMailer, bumailKeyOf, type MailSettings } from "./mailer";

const settings: MailSettings = {
  transport: "bumail",
  smtpUrl: undefined,
  bumailUrl: "http://bumail-app:8090/graphql",
  keyFile: "/run/secrets/mail_api_key",
  from: "no-reply@softistx.com",
  production: true,
};
const key = () => "bumail_test\n";

describe("the server's mailer", () => {
  test("bumail reads its key from the file and builds a mailer", () => {
    expect(typeof buildMailer(settings, key).send).toBe("function");
  });

  test("production refuses bumail without a key file", () => {
    expect(() => buildMailer({ ...settings, keyFile: undefined }, key)).toThrow(
      "BUMAIL_API_KEY_FILE is required",
    );
  });

  test("a key that is unreadable or not a bumail_ key is refused, without quoting it", () => {
    expect(() => buildMailer(settings, () => "secret-value")).toThrow(
      "does not hold a bumail_ key",
    );
    expect(() => bumailKeyOf("/k", () => "  ")).toThrow("bumail_");
    expect(() =>
      bumailKeyOf("/k", () => {
        throw new Error("EACCES");
      }),
    ).toThrow("cannot be read");
    try {
      buildMailer(settings, () => "secret-value");
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
    }
  });

  test("smtp needs MAIL_URL", () => {
    const smtp = { ...settings, transport: "smtp" as const };
    expect(() => buildMailer(smtp, key)).toThrow("MAIL_URL is required");
    expect(
      typeof buildMailer({ ...smtp, smtpUrl: "smtp://localhost:1025" }, key)
        .send,
    ).toBe("function");
  });

  test("production defaults to bumail; elsewhere an unset transport falls back to the console", () => {
    expect(() =>
      buildMailer({ ...settings, transport: undefined, keyFile: undefined }),
    ).toThrow("BUMAIL_API_KEY_FILE");
    const dev = { ...settings, transport: undefined, production: false };
    expect(typeof buildMailer({ ...dev, keyFile: undefined }).send).toBe(
      "function",
    );
  });
});
