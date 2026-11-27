import { readFileSync } from "node:fs";
import { createConsoleMailer, type Mailer } from "@softistx/mail";
import { createBumailMailer } from "@softistx/mail-bumail";
import { createSmtpMailer } from "@softistx/mail-smtp";
import nodemailer from "nodemailer";
import { env } from "./env";

export type MailSettings = {
  transport: "bumail" | "smtp" | undefined;
  smtpUrl: string | undefined;
  bumailUrl: string;
  keyFile: string | undefined;
  from: string;
  production: boolean;
};

// The key's shape only (bumail's isServiceKey): whether it stands is
// `sendEmail`'s to say. Quotes no value.
export function bumailKeyOf(
  file: string,
  read: (file: string) => string = (path) => readFileSync(path, "utf8"),
): string {
  let key: string;
  try {
    key = read(file).trim();
  } catch {
    throw new Error(`BUMAIL_API_KEY_FILE ${file} cannot be read`);
  }
  if (!/^bumail_\S+$/.test(key))
    throw new Error(`BUMAIL_API_KEY_FILE ${file} does not hold a bumail_ key`);
  return key;
}

// The mailer for one set of settings: bumail's Mail API, SMTP through
// MAIL_URL, or, with neither outside production, the console mailer that
// prints each mail. A missing piece stops the start-up.
export function buildMailer(
  settings: MailSettings,
  read?: (file: string) => string,
): Mailer {
  const transport =
    settings.transport ??
    (settings.production ? "bumail" : settings.smtpUrl ? "smtp" : undefined);
  if (transport === "smtp") {
    if (!settings.smtpUrl)
      throw new Error("MAIL_URL is required with MAIL_TRANSPORT=smtp");
    return createSmtpMailer({
      transporter: nodemailer.createTransport(settings.smtpUrl),
    });
  }
  if (transport === "bumail") {
    if (!settings.keyFile) {
      if (settings.production)
        throw new Error(
          "BUMAIL_API_KEY_FILE is required with MAIL_TRANSPORT=bumail",
        );
      return createConsoleMailer();
    }
    return createBumailMailer({
      url: settings.bumailUrl,
      key: bumailKeyOf(settings.keyFile, read),
      from: { name: "storix", address: settings.from },
    });
  }
  return createConsoleMailer();
}

let shared: Mailer | undefined;

// The mailer the server and the worker send with, built once from the env.
export function serverMailer(): Mailer {
  shared ??= buildMailer({
    transport: env.MAIL_TRANSPORT,
    smtpUrl: env.MAIL_URL,
    bumailUrl: env.BUMAIL_URL,
    keyFile: env.BUMAIL_API_KEY_FILE,
    from: env.MAIL_FROM,
    production: Bun.env.NODE_ENV === "production",
  });
  return shared;
}
