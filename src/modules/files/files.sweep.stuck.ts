import { renditionJobId } from "@/queues/renditions";
import type { FilesMongo } from "./files.handle";
import type { RenditionsQueue } from "./files.renditions";

/** A file is stuck `PROCESSING` when untouched for this long. */
export const STUCK_AFTER_MS = 60 * 60_000;
/** Times the sweep queues the job of one file again before it is `FAILED`. */
export const MAX_REQUEUES = 3;
/** Stuck files looked at per workspace and run. */
export const STUCK_BATCH = 100;

export interface StuckOptions {
  now?: () => Date;
  stuckAfterMs?: number;
  maxRequeues?: number;
  batch?: number;
  log?: (message: string) => void;
}

export interface StuckReport {
  // Files whose renditions job was queued again.
  requeued: number;
  // Files that spent their retries and are `FAILED`.
  failed: number;
  // Files left for the next run: the queue refused one, so the scan stopped.
  left?: number;
}

// A file whose renditions job was lost between the commit and `queue.add`
// (the process died, Redis lost it) stays `PROCESSING` for ever. The sweep
// queues the job of such a file again (`stuck<n>` is the job id's token, as
// `redo` is for the crops) and raises its counter; at `maxRequeues` the file
// is `FAILED`: the original stays readable, only its previews are given up. A
// queue that refuses a job stops the scan (it is probably down) and leaves
// that file and the rest for the next run. Every node of a
// shared blob (a copy) moves together.
export async function requeueStuck(
  mongo: FilesMongo,
  queue: RenditionsQueue,
  workspaceId: string,
  options: StuckOptions = {},
): Promise<StuckReport> {
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(
    now.getTime() - (options.stuckAfterMs ?? STUCK_AFTER_MS),
  );
  const max = options.maxRequeues ?? MAX_REQUEUES;
  const log = options.log ?? ((message) => console.warn(message));
  const report: StuckReport = { requeued: 0, failed: 0 };
  const nodes = mongo.db.nodes.raw;
  const stuck = await nodes
    .find({
      status: "PROCESSING",
      updatedAt: { $lt: cutoff },
      blobKey: { $type: "string" },
    })
    .sort({ updatedAt: 1 })
    .limit(options.batch ?? STUCK_BATCH)
    .toArray();
  const seen = new Set<string>();
  for (const [index, node] of stuck.entries()) {
    const key = node["blobKey"] as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const tries = (node["renditionRequeues"] as number | undefined) ?? 0;
    const blob = { blobKey: key, status: "PROCESSING" as const };
    if (tries >= max) {
      const done = await nodes.updateMany(blob, {
        $set: { status: "FAILED", updatedAt: now },
      });
      if (done.modifiedCount > 0) report.failed += 1;
      continue;
    }
    try {
      await queue.add(
        { workspaceId, key },
        { id: renditionJobId({ workspaceId, key }, `stuck${tries + 1}`) },
      );
    } catch (error) {
      log(
        `stuck renditions ${workspaceId}: ${key} not queued: ${error instanceof Error ? error.message : error}`,
      );
      // The queue is probably down, and the refused node keeps its old
      // `updatedAt`: going on would only retry the same oldest files.
      report.left = stuck.length - index;
      break;
    }
    // On purpose a raw write, past the optimistic lock and the audit: the
    // sweep works at blob level, not on a node's versions.
    await nodes.updateMany(blob, {
      $inc: { renditionRequeues: 1 },
      $set: { updatedAt: now },
    });
    report.requeued += 1;
  }
  return report;
}
