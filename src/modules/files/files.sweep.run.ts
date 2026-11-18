import type { BoundBucket } from "@softistx/s3";
import type { FilesMongo } from "./files.handle";
import type { RenditionsQueue } from "./files.renditions";
import type { StuckOptions, StuckReport } from "./files.sweep.stuck";

// What the sweep needs of the bucket: the listing, and the delete that
// `@alxia/media`'s routes use.
export type SweepBucket = Pick<
  BoundBucket<{ readonly key: string }>,
  "list" | "delete"
>;

/** An object nobody recorded is an orphan this long after its last write. */
export const ORPHAN_MARGIN_MS = 75 * 60_000;
/** Blobs read, and objects listed, per page. */
export const SWEEP_BATCH = 100;
/** Objects removed per workspace and run (the rest waits for the next one). */
export const SWEEP_MAX_DELETES = 1_000;

export interface SweepOptions extends StuckOptions {
  // Given, the sweep also queues the files stuck `PROCESSING` again.
  renditions?: RenditionsQueue;
  log?: (message: string) => void;
  now?: () => Date;
  orphanMarginMs?: number;
  batch?: number;
  maxDeletes?: number;
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
