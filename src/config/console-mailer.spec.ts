import { describe, expect, test } from "bun:test";
import { createConsoleMailer, redactTokens } from "./console-mailer";

const mail = {
  from: "noreply@storix.test",
  to: "ada@storix.test",
  subject: "Confirm your address",
  html: "<p>Open</p>",
  text: "Open https://storix.test/auth/verify-email?token=abc123_DEF-456&x=1 now.",
};

describe("redactTokens", () => {
  test("hides the value of a token parameter, wherever it stands", () => {
    expect(redactTokens(mail.text)).toBe(
      "Open https://storix.test/auth/verify-email?token=[redacted]&x=1 now.",
    );
    expect(redactTokens("a?x=1&token=zzz")).toBe("a?x=1&token=[redacted]");
    expect(redactTokens("(https://s.test/?token=zzz)")).toBe(
      "(https://s.test/?token=[redacted])",
    );
  });

  test("leaves a text without a token as it is", () => {
    expect(redactTokens("Hello, no link here")).toBe("Hello, no link here");
  });
});

describe("the console mailer", () => {
  test("prints the recipient, subject and text, and answers a message id", async () => {
    const lines: string[] = [];
    const mailer = createConsoleMailer({
      log: (line) => lines.push(line),
      revealTokens: true,
    });
    const sent = await mailer.send(mail);
    expect(sent.messageId).toBe("console-1");
    expect(lines[0]).toContain("to ada@storix.test: Confirm your address");
    expect(lines[0]).toContain("token=abc123_DEF-456");
    expect((await mailer.send(mail)).messageId).toBe("console-2");
  });

  test("redacts the tokens unless they are revealed", async () => {
    const lines: string[] = [];
    await createConsoleMailer({
      log: (line) => lines.push(line),
      revealTokens: false,
    }).send(mail);
    expect(lines[0]).toContain("token=[redacted]");
    expect(lines[0]).not.toContain("abc123");
  });
});
