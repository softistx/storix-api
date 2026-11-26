import { isMediaKey } from "@softistx/alxia-media";
import type { BoundBucket } from "@softistx/s3";
import type { FilesMongo } from "../models";
import { CLOCK_SKEW_MS } from "../rules";

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
  // True when a brake stopped the workspace (nothing, or only part, was swept).
  braked: boolean;
  // True when the per-run delete cap left work for the next run.
  capped: boolean;
}

export interface Sweep {
  mongo: FilesMongo;
  bucket: SweepBucket;
  workspaceId: string;
  log: (message: string) => void;
  now: () => Date;
  margin: number;
  batch: number;
  // Objects the run may still remove, out of `max`.
  left: number;
  max: number;
  // A `refs` 0 blob younger than this is kept.
  graceMs: number;
  // Renews the workspace's lease: false when another run took it over.
  renew: () => Promise<boolean>;
  // Set once the lease was lost: the steps stop.
  lost: boolean;
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
  // The cap counts what was removed, not what was attempted.
  run.left -= keys.length - failed;
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

type Listed = Awaited<ReturnType<SweepBucket["list"]>>["items"];

// The distinct media keys on a page of listed objects that were last written
// before the margin, each with its objects, and whether any object is dated
// in the future (the host clock and the storage's disagree).
export function oldKeysOf(run: Sweep, items: Listed, prefix: string) {
  const now = run.now().getTime();
  const cutoff = now - run.margin;
  const old = new Map<string, string[]>();
  let future = false;
  for (const item of items) {
    const at = item.lastModified?.getTime();
    if (at !== undefined && at > now + CLOCK_SKEW_MS) future = true;
    const key = item.key.slice(prefix.length).split("/")[0] ?? "";
    if (!isMediaKey(key) || at === undefined || at >= cutoff) continue;
    old.set(key, [...(old.get(key) ?? []), item.key]);
  }
  return { old, future };
}

// Whether `n` more objects fit in the run's cap. A key that alone exceeds the
// whole cap still goes first, so the sweep always advances. Marks `capped`.
export function cannotAfford(run: Sweep, n: number): boolean {
  if (run.left > 0 && (n <= run.left || run.left === run.max)) return false;
  run.report.capped = true;
  return true;
}
