import { defineQueue } from "@softistx/redis";
import { z } from "zod";

// The queue of the notification mails: the request prepares the mail (the
// recipient's language, the texts) and adds one job per recipient; the worker
// (`src/worker.ts`) sends it, so a slow or failing SMTP server never holds a
// request. One job per notification (its id), so a retried add sends once.

export const MAILS_QUEUE = "mails";

export const mailJob = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
});
export type MailJob = z.output<typeof mailJob>;

export const mails = defineQueue({
  name: MAILS_QUEUE,
  schema: mailJob,
  attempts: 5,
  backoff: { base: "30s", max: "30m" },
  timeout: "1m",
  lease: "2m",
  keepCompleted: { age: "1h", count: 1_000 },
  keepFailed: "7d",
});
