import type { Mailer } from "@softistx/mail";
import type { AppRedis } from "../config/redis";
import { mailsHandler } from "../modules/notifications/public";

// Jobs one worker process sends at once: a send is a network call.
export const MAILS_CONCURRENCY = 4;

// Starts the mails worker on the app's Redis, as the renditions' one:
// dist/worker.js runs it as its own process.
export function startMailsWorker(
  redis: AppRedis,
  mailer: Mailer,
  from: string,
  options: { concurrency?: number; log?: (message: string) => void } = {},
) {
  const log = options.log ?? ((message: string) => console.warn(message));
  const worker = redis.queues.mails.work(mailsHandler(mailer, from), {
    concurrency: options.concurrency ?? MAILS_CONCURRENCY,
  });
  worker.on("error", (error) => log(`mails worker: ${String(error)}`));
  worker.on("failed", ({ id, error }) =>
    log(`mails job ${id} failed: ${error.message}`),
  );
  return worker;
}
