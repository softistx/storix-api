import type { Mailer } from "@softistx/mail";
import type { Identity } from "../core/identity";
import type { Notify } from "../core/notify";
import type { Translations } from "../core/translations/translations.load";
import {
  directSender,
  Notifier,
  queuedSender,
} from "../modules/notifications/public";
import { env } from "./env";
import { serverMailer } from "./mailer";
import { appRedis } from "./redis";

// The mailer of the server's notification mails, shared by every request.
const defaultMailer = serverMailer();

// The notifier an app runs: the notifications module's, over the identity
// (recipients' addresses and languages), the translations (the mail texts) and
// the mails queue; with no Redis (specs, a bare dev server) the mail is sent
// at once and a failure is only logged. Specs hand their own mailer.
export function notifierOf(
  identity: Identity,
  options: { mailer?: Mailer; translations?: Translations },
): Notify {
  const { mailer, translations } = options;
  const queue = mailer === undefined ? appRedis?.queues.mails : undefined;
  return new Notifier({
    accounts: identity.accounts,
    send: queue
      ? queuedSender(queue)
      : directSender(mailer ?? defaultMailer, env.MAIL_FROM),
    text: (language, key, params) =>
      translations ? translations.text(language, key, params) : key,
  });
}
