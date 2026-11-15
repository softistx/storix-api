import type { MediaBucket } from "@alxia/media";
import type { AppRedis } from "../config/redis";
import { store } from "../config/tenancy";
import { type FilesMongo, renditionsHandler } from "../modules/files/public";

// Jobs one worker process renders at once: a decode holds up to ~200 MB.
export const RENDITIONS_CONCURRENCY = 2;

// Starts the renditions worker on the app's Redis: dist/worker.js runs it as
// its own process. `redis.close({ grace })` stops it after the running jobs.
export function startRenditionsWorker(
  redis: AppRedis,
  bucket: MediaBucket,
  options: { concurrency?: number; log?: (message: string) => void } = {},
) {
  const log = options.log ?? ((message: string) => console.warn(message));
  const worker = redis.queues.renditions.work(
    renditionsHandler({
      bucket,
      // The registry types the slot (`Register`), the store's databases are
      // plain records: the one cast of this file, as in files.resolver.ts.
      mongoOf: async (workspaceId) =>
        (await store.databaseOf(workspaceId)) as unknown as FilesMongo,
    }),
    { concurrency: options.concurrency ?? RENDITIONS_CONCURRENCY },
  );
  worker.on("error", (error) => log(`renditions worker: ${String(error)}`));
  worker.on("failed", ({ id, error }) =>
    log(`renditions job ${id} failed: ${error.message}`),
  );
  return worker;
}
