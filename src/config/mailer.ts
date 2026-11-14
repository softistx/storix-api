import { createConsoleMailer, type Mailer } from "@softistx/mail";
import { createSmtpMailer } from "@softistx/mail-smtp";
import nodemailer from "nodemailer";

// The mailer the server sends with: SMTP through MAIL_URL (smtp:// or
// smtps://, credentials in the URL, which production requires, src/config/
// env.ts), else the console mailer, which prints each mail.
export function serverMailer(url: string | undefined): Mailer {
  return url
    ? createSmtpMailer({ transporter: nodemailer.createTransport(url) })
    : createConsoleMailer();
}
