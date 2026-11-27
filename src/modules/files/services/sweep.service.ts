import { ConflictError } from "@softistx/mongo";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { FilesMongo } from "../models";
import { filesMongo } from "../models";
import {
  type Focal,
  RELEASE_GRACE_MS,
  RELEASED_BRAKE,
  type RenditionsQueue,
} from "../rules";
import {
  cannotAfford,
  oldKeysOf,
  removeObjects,
  type StuckReport,
  type Sweep,
  type SweepBucket,
  type SweepReport,
} from "../utils";
import {
  giveSweepLockBack,
  renewSweepLock,
  takeSweepLock,
} from "./sweep.lock.service";
import { type RequeueStep, requeueOne } from "./sweep.requeue.service";
import { dryPass, releaseOne, unrecordedOf } from "./sweep.steps.service";

export {
  CLOCK_SKEW_MS,
  ORPHAN_BRAKE,
  ORPHAN_BRAKE_RATIO,
  RELEASE_GRACE_MS,
  RELEASED_BRAKE,
} from "../rules";
export type { StuckReport, SweepBucket, SweepReport };

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
  // Stuck files looked at per run (`batch` is the blobs and objects read).
  stuckBatch?: number;
  maxDeletes?: number;
  // A `refs` 0 blob younger than this is kept (`RELEASE_GRACE_MS`).
  graceMs?: number;
}

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

// A file whose renditions job was lost between the commit and `queue.add`
// (the process died, Redis lost it) stays `PROCESSING` for ever. The sweep
// queues the job of such a file again (`stuck<n>-<uuid>` is the job id's token, as
// `redo` is for the crops) and raises its counter; at `maxRequeues` the file
// is `FAILED`: the original stays readable, only its previews are given up. A
// queue that refuses a job stops the scan (it is probably down) and leaves
// that file and the rest for the next run. Every node of a
// shared blob (a copy) moves together.
//
// A file whose focal-point crops are stuck (`cropsStatus` `PROCESSING`, its
// `status` `READY`) is scanned the same way, with a crops job.
export async function requeueStuck(
  mongo: FilesMongo,
  queue: RenditionsQueue,
  workspaceId: string,
  options: StuckOptions = {},
): Promise<StuckReport> {
  const files = await requeueScope(mongo, queue, workspaceId, "file", options);
  if (files.nodesLeft !== undefined) return files;
  const crops = await requeueScope(mongo, queue, workspaceId, "crops", options);
  return {
    requeued: files.requeued + crops.requeued,
    failed: files.failed + crops.failed,
    ...(crops.nodesLeft !== undefined && { nodesLeft: crops.nodesLeft }),
  };
}

async function requeueScope(
  mongo: FilesMongo,
  queue: RenditionsQueue,
  workspaceId: string,
  scope: "file" | "crops",
  options: StuckOptions,
): Promise<StuckReport> {
  const field: RequeueStep["field"] =
    scope === "crops" ? "cropsStatus" : "status";
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
      [field]: "PROCESSING",
      // `null` also matches a node with no `renditionsAt`: an older build
      // (rolling deploy, rollback) writes `PROCESSING` without it, and it is
      // then judged by `updatedAt`.
      $or: [
        { renditionsAt: { $lt: cutoff } },
        { renditionsAt: null, updatedAt: { $lt: cutoff } },
      ],
      blobKey: { $type: "string" },
    })
    .sort({ renditionsAt: 1 })
    .limit(options.batch ?? STUCK_BATCH)
    .toArray();
  const seen = new Set<string>();
  const step = { queue, workspaceId, scope, field, now, max, log };
  for (const [index, node] of stuck.entries()) {
    const key = node["blobKey"] as string;
    const point = (node["focalPoint"] as Focal | null | undefined) ?? null;
    // One job per blob and focal point: copies at other points need their own.
    const once = `${key}:${point ? `${point.x}:${point.y}` : ""}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const tries = (node["renditionRequeues"] as number | undefined) ?? 0;
    const outcome = await requeueOne(mongo, step, key, point, tries);
    if (outcome === "down") {
      // The queue is probably down, and the refused node keeps its old
      // `renditionsAt`: going on would only retry the same oldest files.
      report.nodesLeft = stuck.length - index;
      break;
    }
    if (outcome !== "skipped") report[outcome] += 1;
  }
  return report;
}

// Reserves a key nobody records: a blob with `refs` 0 under it, released now
// (so the next run removes it once the grace window has passed). `addFile`
// finds a blob and refuses the key (`key-unknown`), and a key it recorded
// first makes the insert conflict, so a recorded object is never deleted.
async function claim(run: Sweep, key: string): Promise<boolean> {
  try {
    await run.mongo.db.blobs.create({
      key,
      size: 0,
      mimeType: "application/octet-stream",
      refs: 0,
      releasedAt: run.now(),
    });
    return true;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}

// The objects under the workspace's `files` prefix that no blob records and
// that were last written before the margin: a `/media` PUT that `addFile`
// never recorded, and its sizes. Each key is claimed, its objects removed,
// the claim is kept (a released blob the next run removes after the grace
// window), so a recorder that opened the object before its removal is still
// refused after it. An object dated in the future stops the workspace.
export async function sweepOrphans(run: Sweep) {
  const prefix = `workspaces/${run.workspaceId}/files/`;
  for (let cursor: string | null = null; ; ) {
    if (!(await run.renew())) {
      run.lost = true;
      return;
    }
    const page: Awaited<ReturnType<Sweep["bucket"]["list"]>> =
      await run.bucket.list({ prefix, limit: run.batch, cursor });
    const { old, future } = oldKeysOf(run, page.items, prefix);
    if (future) {
      run.report.braked = true;
      run.log(
        `storage sweep ${run.workspaceId} stopped: an object is dated in the future (clock skew)`,
      );
      return;
    }
    for (const key of await unrecordedOf(run, [...old.keys()])) {
      const objects = old.get(key) ?? [];
      if (cannotAfford(run, objects.length)) return;
      if (!(await claim(run, key))) continue;
      const failed = await removeObjects(run, objects);
      // The claim stays: an `addFile` that opened the object before this
      // removal and records after it still finds the blob and is refused.
      // The released step removes it later (and retries a failed delete).
      run.report.failed += failed;
      run.report.orphans += objects.length - failed;
    }
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

// The blobs nothing references (`refs` 0) and released (or claimed) before
// the grace window, that no node or version holds: the blob goes first, with a
// delete that only matches while `refs` is still 0, then its object and its
// sizes. A failed object delete leaves an unrecorded object that
// `sweepOrphans` removes once it is old enough. Pages by key, so a blob kept
// is not read again. A mass of them, far above the recorded blobs, stops the
// step (braked).
async function sweepReleased(run: Sweep) {
  const blobs = run.mongo.db.blobs.raw;
  const cutoff = new Date(run.now().getTime() - run.graceMs);
  const removable = { refs: 0, releasedAt: { $lt: cutoff } };
  const count = await blobs.countDocuments(removable, {
    limit: RELEASED_BRAKE,
  });
  if (
    count >= RELEASED_BRAKE &&
    count > 2 * (await blobs.countDocuments({ refs: { $gt: 0 } }))
  ) {
    run.report.braked = true;
    run.log(
      `storage sweep ${run.workspaceId} stopped: at least ${count} released blobs against the recorded ones`,
    );
    return;
  }
  for (let last = ""; ; ) {
    if (!(await run.renew())) {
      run.lost = true;
      return;
    }
    const page = await blobs
      .find({ ...removable, key: { $gt: last } })
      .sort({ key: 1 })
      .limit(run.batch)
      .toArray();
    if (page.length === 0) return;
    for (const blob of page) {
      last = blob.key;
      if ((await releaseOne(run, blob.key, cutoff)) === "capped") return;
    }
  }
}

// One workspace, under its sweep lock: a run that finds another holding it
// does nothing and says `skipped`, so two sweeps never both act (nor both raise
// a stuck file's `renditionRequeues`). A crashed run's lock expires.
export async function sweepWorkspace(
  mongo: FilesMongo,
  bucket: SweepBucket,
  workspaceId: string,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const held = await takeSweepLock(
    mongo,
    (options.now ?? (() => new Date()))(),
  );
  if (held === null) {
    return {
      released: 0,
      orphans: 0,
      failed: 0,
      skipped: true,
      braked: false,
      capped: false,
    };
  }
  try {
    return await sweepLocked(mongo, bucket, workspaceId, options, held);
  } finally {
    await giveSweepLockBack(mongo, held);
  }
}

// One workspace: a dry first pass (the brakes), then its released blobs, then
// the unrecorded objects older than the margin, then (given the renditions
// queue) the files stuck `PROCESSING`. Usage is not touched: it counts only
// blobs with `refs` above 0 (`recountStorage`), and a released one is already
// out of it. A brake stops the workspace (`braked`); the cap is `capped`.
// Never throws for a delete or the stuck scan: it logs, counts it in `failed`
// and goes on.
async function sweepLocked(
  mongo: FilesMongo,
  bucket: SweepBucket,
  workspaceId: string,
  options: SweepOptions,
  held: string,
): Promise<SweepReport> {
  const report: SweepReport = {
    released: 0,
    orphans: 0,
    failed: 0,
    braked: false,
    capped: false,
  };
  const now = options.now ?? (() => new Date());
  const max = options.maxDeletes ?? SWEEP_MAX_DELETES;
  const run: Sweep = {
    mongo,
    bucket,
    workspaceId,
    log: options.log ?? ((message) => console.warn(message)),
    now,
    margin: options.orphanMarginMs ?? ORPHAN_MARGIN_MS,
    batch: options.batch ?? SWEEP_BATCH,
    left: max,
    max,
    graceMs: options.graceMs ?? RELEASE_GRACE_MS,
    // The lease is renewed every page and between the steps; a run that lost
    // it stops there and reports the workspace skipped (what it did stays
    // counted), never failed.
    renew: () => renewSweepLock(mongo, held, now()),
    lost: false,
    report,
  };
  const why = await dryPass(run);
  if (run.lost) return { ...report, skipped: true };
  if (why !== null) {
    run.log(`storage sweep ${workspaceId} stopped: ${why}`);
    return { ...report, braked: true };
  }
  await sweepReleased(run);
  if (run.lost || !(await run.renew())) return { ...report, skipped: true };
  if (!report.braked) await sweepOrphans(run);
  if (run.lost || !(await run.renew())) return { ...report, skipped: true };
  if (options.renditions) await requeueStep(run, options.renditions, options);
  return report;
}

// The third step: the files stuck `PROCESSING` are queued again. A failing
// scan is logged and counted in `failed`; it never throws.
async function requeueStep(
  run: Sweep,
  renditions: RenditionsQueue,
  options: SweepOptions,
): Promise<void> {
  try {
    run.report.stuck = await requeueStuck(
      run.mongo,
      renditions,
      run.workspaceId,
      {
        now: run.now,
        log: run.log,
        ...(options.stuckAfterMs !== undefined && {
          stuckAfterMs: options.stuckAfterMs,
        }),
        ...(options.maxRequeues !== undefined && {
          maxRequeues: options.maxRequeues,
        }),
        ...(options.stuckBatch !== undefined && {
          batch: options.stuckBatch,
        }),
      },
    );
  } catch (error) {
    run.log(
      `stuck renditions ${run.workspaceId}: scan failed: ${error instanceof Error ? error.message : error}`,
    );
    run.report.failed += 1;
  }
}

// Sweeps every active workspace, one after the other; a workspace that fails
// is reported and does not stop the others.
export async function sweepAll(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
  bucket: SweepBucket,
  options: SweepOptions = {},
): Promise<{
  done: ({ workspaceId: string } & SweepReport)[];
  failed: { workspaceId: string; error: unknown }[];
}> {
  const workspaces = await core.db.workspaces.findMany({
    filter: { status: "active" },
  });
  const done: ({ workspaceId: string } & SweepReport)[] = [];
  const failed: { workspaceId: string; error: unknown }[] = [];
  for (const workspace of workspaces) {
    try {
      const mongo = filesMongo(await databaseOf(workspace.id));
      const report = await sweepWorkspace(mongo, bucket, workspace.id, options);
      done.push({ workspaceId: workspace.id, ...report });
    } catch (error) {
      failed.push({ workspaceId: workspace.id, error });
    }
  }
  return { done, failed };
}
