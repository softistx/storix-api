import type { Mailer } from "@softistx/mail";
import type { Handler } from "@softistx/redis";
import type { mailJob } from "@/queues/mails";

// What the notifier hands a prepared mail to: the queue in production, the
// mailer itself where there is no Redis (specs, a bare dev server).
export type MailSender = (
  mail: (typeof mailJob)["_output"],
  id: string,
) => Promise<void>;

// The job's id is the notification's: adding it twice sends one mail.
export const queuedSender =
  (queue: {
    add(job: (typeof mailJob)["_output"], options: { id: string }): unknown;
  }): MailSender =>
  async (mail, id) => {
    await queue.add(mail, { id });
  };

export const directSender =
  (mailer: Mailer, from: string): MailSender =>
  async (mail, id) => {
    await mailer.send({
      from: { name: "storix", address: from },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      idempotencyKey: id,
    });
  };

// The worker's handler: a send that fails throws, and the queue retries it.
export const mailsHandler =
  (mailer: Mailer, from: string): Handler<typeof mailJob> =>
  async ({ data, id }) => {
    await directSender(mailer, from)(data, id);
  };
