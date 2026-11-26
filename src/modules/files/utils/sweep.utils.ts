import type { BoundBucket } from "@softistx/s3";
import type { FilesMongo } from "../models";

// What the sweep needs of the bucket: the listing, and the delete that
// `@softistx/alxia-media`'s routes use.
export type SweepBucket = Pick<
  BoundBucket<{ readonly key: string }>,
  "list" | "delete"
>;

export interface StuckReport {
  // Files whose renditions job was queued again.
  requeued: number;
  // Files that spent their retries and are `FAILED`.
  failed: number;
  // Nodes left for the next run: the queue refused a job, so the scan stopped
  // at that node (it counts the nodes of the scanned batch from there on).
  nodesLeft?: number;
}

export interface SweepReport {
  // Blobs with `refs` 0 removed, each with its object and its sizes.
  released: number;
  // Objects of keys nobody recorded, removed.
  orphans: number;
  // Objects or blobs whose removal failed, left for the next run.
  failed: number;
  // Present when the sweep was given the renditions queue.
  stuck?: StuckReport;
  // True when another sweep of the workspace held the lock: nothing was done.
  skipped?: boolean;
}

export interface Sweep {
  mongo: FilesMongo;
  bucket: SweepBucket;
  workspaceId: string;
  log: (message: string) => void;
  now: () => Date;
  margin: number;
  batch: number;
  left: number;
  report: SweepReport;
}

// Removes the objects, one by one. Returns how many it could not remove; a
// failure is logged and never thrown.
export async function removeObjects(
  run: Sweep,
  keys: readonly string[],
): Promise<number> {
  let failed = 0;
  for (const key of keys) {
    try {
      await run.bucket.delete({ key });
    } catch (error) {
      failed += 1;
      run.log(
        `storage sweep ${run.workspaceId}: ${key} not removed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  run.left -= keys.length;
  return failed;
}

// Every key under `<object>/`: the renditions an object has made.
export async function sizesOf(run: Sweep, objectKey: string) {
  const keys: string[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: Awaited<ReturnType<SweepBucket["list"]>> =
      await run.bucket.list({
        prefix: `${objectKey}/`,
        limit: run.batch,
        cursor,
      });
    keys.push(...page.items.map((item) => item.key));
    if (page.nextCursor === null) return keys;
    cursor = page.nextCursor;
  }
}
