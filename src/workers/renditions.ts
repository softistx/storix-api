import type { MediaBucket } from "@softistx/alxia-media";
import type { AppRedis } from "../config/redis";
import { store } from "../config/tenancy";
import {
  filesMongo,
  markRenditionsFailed,
  renditionsHandler,
} from "../modules/files/public";

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
  const deps = {
    bucket,
    mongoOf: async (workspaceId: string) =>
      filesMongo(await store.databaseOf(workspaceId)),
  };
  const worker = redis.queues.renditions.work(renditionsHandler(deps), {
    concurrency: options.concurrency ?? RENDITIONS_CONCURRENCY,
  });
  worker.on("error", (error) => log(`renditions worker: ${String(error)}`));
  worker.on("failed", ({ id, error }) => {
    log(`renditions job ${id} failed: ${error.message}`);
    // The handler marks the node itself; this covers a run that never got to.
    markRenditionsFailed(deps, id).catch((cause) =>
      log(`renditions job ${id}: could not mark it FAILED: ${String(cause)}`),
    );
  });
  return worker;
}
