import { isMediaKey, mediaPlace } from "@softistx/alxia-media";
import { ConflictError } from "@softistx/mongo";
import type { WorkspacesMongo } from "@/core/workspaces";
import { renditionJobId } from "@/queues/renditions";
import type { FilesMongo } from "../models";
import { filesMongo } from "../models";
import type { RenditionsQueue } from "../rules";
import {
  removeObjects,
  type StuckReport,
  type Sweep,
  type SweepBucket,
  type SweepReport,
  sizesOf,
} from "../utils";
import { giveSweepLockBack, takeSweepLock } from "./sweep.lock.service";

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
  for (const [index, node] of stuck.entries()) {
    const key = node["blobKey"] as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const tries = (node["renditionRequeues"] as number | undefined) ?? 0;
    const blob = { blobKey: key, status: "PROCESSING" as const };
    if (tries >= max) {
      const done = await nodes.updateMany(blob, {
        $set: { status: "FAILED" },
      });
      if (done.modifiedCount > 0) report.failed += 1;
      continue;
    }
    try {
      await queue.add(
        { workspaceId, key },
        {
          id: renditionJobId(
            { workspaceId, key },
            // Unique per attempt: the counter is reset to 0 by a READY, a
            // focal move or a new version, and the queue keeps the first job
            // of an id it already holds (failed ones for 7 days).
            `stuck${tries + 1}-${crypto.randomUUID()}`,
          ),
        },
      );
    } catch (error) {
      log(
        `stuck renditions ${workspaceId}: ${key} not queued: ${error instanceof Error ? error.message : error}`,
      );
      // The queue is probably down, and the refused node keeps its old
      // `renditionsAt`: going on would only retry the same oldest files.
      report.nodesLeft = stuck.length - index;
      break;
    }
    // On purpose a raw write, past the optimistic lock and the audit: the
    // sweep works at blob level, not on a node's versions.
    await nodes.updateMany(blob, {
      $inc: { renditionRequeues: 1 },
      $set: { renditionsAt: now },
    });
    report.requeued += 1;
  }
  return report;
}

/**
 * A page of this many old, distinct keys that no blob records, in a workspace
 * whose `blobs` collection is empty, is not swept: a wrong database against
 * the real bucket would otherwise wipe it.
 */
export const ORPHAN_BRAKE = 10;

// Reserves a key nobody records: a blob with `refs` 0 under it. `addFile`
// finds a blob and refuses the key (`key-unknown`), and a key it recorded
// first makes the insert conflict, so a recorded object is never deleted.
async function claim(run: Sweep, key: string): Promise<boolean> {
  try {
    await run.mongo.db.blobs.create({
      key,
      size: 0,
      mimeType: "application/octet-stream",
      refs: 0,
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
// then the claim lifted (a claim a crash left is a released blob the next run
// removes).
export async function sweepOrphans(run: Sweep) {
  const blobs = run.mongo.db.blobs;
  const prefix = `workspaces/${run.workspaceId}/files/`;
  const cutoff = run.now().getTime() - run.margin;
  for (let cursor: string | null = null; run.left > 0; ) {
    const page: Awaited<ReturnType<Sweep["bucket"]["list"]>> =
      await run.bucket.list({ prefix, limit: run.batch, cursor });
    const old = new Map<string, string[]>();
    for (const item of page.items) {
      const key = item.key.slice(prefix.length).split("/")[0] ?? "";
      const at = item.lastModified?.getTime();
      if (!isMediaKey(key) || at === undefined || at >= cutoff) continue;
      old.set(key, [...(old.get(key) ?? []), item.key]);
    }
    const keys = [...old.keys()];
    if (keys.length > 0) {
      const held = await blobs.raw
        .find({ key: { $in: keys } }, { projection: { key: 1 } })
        .toArray();
      const recorded = new Set(held.map((blob) => blob.key));
      const orphans = keys.filter((key) => !recorded.has(key));
      if (
        orphans.length >= ORPHAN_BRAKE &&
        orphans.length === keys.length &&
        (await blobs.raw.estimatedDocumentCount()) === 0
      ) {
        run.log(
          `storage sweep ${run.workspaceId} stopped: no blob records any of ${orphans.length} old keys on a page`,
        );
        return;
      }
      for (const key of orphans) {
        if (run.left <= 0) return;
        if (!(await claim(run, key))) continue;
        const objects = old.get(key) ?? [];
        const failed = await removeObjects(run, objects);
        await blobs.raw.deleteOne({ key, refs: 0 });
        run.report.failed += failed;
        run.report.orphans += objects.length - failed;
      }
    }
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

// The blobs nothing references (`refs` 0): the blob goes first, with a delete
// that only matches while `refs` is still 0, then its object and its sizes. A
// failed object delete leaves an unrecorded object that `sweepOrphans` removes
// once it is old enough.
async function sweepReleased(run: Sweep) {
  const place = mediaPlace("files", `workspaces/${run.workspaceId}`);
  const blobs = run.mongo.db.blobs;
  while (run.left > 0) {
    const page = await blobs.findMany({
      filter: { refs: 0 },
      limit: run.batch,
    });
    if (page.length === 0) return;
    for (const blob of page) {
      if (run.left <= 0) return;
      const gone = await blobs.raw.deleteOne({ key: blob.key, refs: 0 });
      if (gone.deletedCount === 0) continue;
      const objectKey = place(blob.key);
      const failed = await removeObjects(run, [
        objectKey,
        ...(await sizesOf(run, objectKey)),
      ]);
      run.report.failed += failed;
      if (failed === 0) run.report.released += 1;
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
    return { released: 0, orphans: 0, failed: 0, skipped: true };
  }
  try {
    return await sweepLocked(mongo, bucket, workspaceId, options);
  } finally {
    await giveSweepLockBack(mongo, held);
  }
}

// One workspace: its released blobs, then the unrecorded objects older than
// the margin, then (given the renditions queue) the files stuck `PROCESSING`.
// Usage is not touched: it counts only blobs with `refs` above 0
// (`recountStorage`), and a released one is already out of it. Never throws
// for a delete or the stuck scan: it logs, counts it in `failed` and goes on.
async function sweepLocked(
  mongo: FilesMongo,
  bucket: SweepBucket,
  workspaceId: string,
  options: SweepOptions,
): Promise<SweepReport> {
  const report: SweepReport = { released: 0, orphans: 0, failed: 0 };
  const run: Sweep = {
    mongo,
    bucket,
    workspaceId,
    log: options.log ?? ((message) => console.warn(message)),
    now: options.now ?? (() => new Date()),
    margin: options.orphanMarginMs ?? ORPHAN_MARGIN_MS,
    batch: options.batch ?? SWEEP_BATCH,
    left: options.maxDeletes ?? SWEEP_MAX_DELETES,
    report,
  };
  await sweepReleased(run);
  if (run.left > 0) await sweepOrphans(run);
  if (options.renditions) {
    try {
      report.stuck = await requeueStuck(
        mongo,
        options.renditions,
        workspaceId,
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
        `stuck renditions ${workspaceId}: scan failed: ${error instanceof Error ? error.message : error}`,
      );
      report.failed += 1;
    }
  }
  return report;
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
