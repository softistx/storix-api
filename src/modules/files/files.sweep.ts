import { mediaPlace } from "@alxia/media";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { FilesMongo } from "./files.service";
import { sweepOrphans } from "./files.sweep.orphans";
import {
  ORPHAN_MARGIN_MS,
  removeObjects,
  SWEEP_BATCH,
  SWEEP_MAX_DELETES,
  type Sweep,
  type SweepBucket,
  type SweepOptions,
  type SweepReport,
  sizesOf,
} from "./files.sweep.run";

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

// One workspace: its released blobs, then the unrecorded objects older than
// the margin. Usage is not touched: it counts only blobs with `refs` above 0
// (`recountStorage`), and a released one is already out of it. Never throws
// for a delete: it logs, counts it in `failed` and goes on.
export async function sweepWorkspace(
  mongo: FilesMongo,
  bucket: SweepBucket,
  workspaceId: string,
  options: SweepOptions = {},
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
      const mongo = (await databaseOf(workspace.id)) as FilesMongo;
      const report = await sweepWorkspace(mongo, bucket, workspace.id, options);
      done.push({ workspaceId: workspace.id, ...report });
    } catch (error) {
      failed.push({ workspaceId: workspace.id, error });
    }
  }
  return { done, failed };
}
