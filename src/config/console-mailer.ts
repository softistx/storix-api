// Temporary, until nxgt-mail#158 (a console Mailer with token redaction).
import type { Mailer, MailMessage } from "@softistx/mail";

// A link's token, up to the end of its value: what the console must not
// print outside development, where a log is read by more than the developer.
const tokens = /([?&]token=)[^\s&"'<>)]+/g;
export const redactTokens = (text: string) =>
  text.replace(tokens, "$1[redacted]");

// A mailer that sends nothing: it prints each mail's recipients, subject and
// text to the console, for development without an SMTP server (MAIL_URL
// unset; production requires one, src/config/env.ts). The links' tokens are
// printed under NODE_ENV=development alone, so a developer follows them;
// `[redacted]` stands in for them anywhere else.
export function createConsoleMailer(
  options: { log?: (line: string) => void; revealTokens?: boolean } = {},
): Mailer {
  const log = options.log ?? console.log;
  const reveal = options.revealTokens ?? Bun.env.NODE_ENV === "development";
  let sent = 0;
  return {
    async send(message: MailMessage) {
      sent += 1;
      const to = [message.to]
        .flat()
        .map((address) =>
          typeof address === "string" ? address : address.address,
        );
      const text = reveal ? message.text : redactTokens(message.text);
      log(`[mail] to ${to.join(", ")}: ${message.subject}\n${text}`);
      return { messageId: `console-${sent}` };
    },
  };
}
