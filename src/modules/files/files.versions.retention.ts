import type { WorkspacesMongo } from "@/core/workspaces";
import { lockTree, type NodeDoc, nodesMongo } from "@/modules/nodes/public";
import { filesMongo } from "./files.handle";
import type { FilesMongo } from "./files.service";
import { removeVersion } from "./files.versions";

// The workspace settings of plan §3.3 (`versionsMax`, `versionsDays`) are not
// stored yet: these are their defaults, and a run may pass others.
export const VERSIONS_MAX = 20;
export const VERSIONS_DAYS = 90;
const DAY_MS = 86_400_000;

// The most files one run settles per workspace (the next run takes the rest).
const FILES_PER_RUN = 500;

export interface RetentionOptions {
  max?: number;
  days?: number;
  now?: () => Date;
  files?: number;
  log?: (message: string) => void;
}

export interface RetentionReport {
  files: number;
  removed: number;
}

// The files that have a version to drop: more than one version, and either
// more than `max` of them or one older than `days` (a lone version is the
// current one).
async function candidates(mongo: FilesMongo, cutoff: Date, max: number) {
  const found = await mongo.db.versions.raw
    .aggregate<{ _id: NodeDoc["_id"] }>([
      {
        $group: {
          _id: "$fileId",
          n: { $sum: 1 },
          oldest: { $min: "$createdAt" },
        },
      },
      {
        $match: {
          n: { $gt: 1 },
          $or: [{ n: { $gt: max } }, { oldest: { $lt: cutoff } }],
        },
      },
      { $limit: FILES_PER_RUN },
    ])
    .toArray();
  return found.map((row) => row._id);
}

// Drops the versions a workspace no longer keeps (plan §3.9): those past the
// newest `versionsMax` and those older than `versionsDays`, never the current
// one. Each file is settled in its own transaction under its owner's tree
// lock, so a new version made meanwhile is never lost: the rows are read
// again inside it. A blob nothing holds is released for the sweep.
export async function retainVersions(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const max = options.max ?? VERSIONS_MAX;
  const days = options.days ?? VERSIONS_DAYS;
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const report: RetentionReport = { files: 0, removed: 0 };
  const ids = await candidates(mongo, cutoff, max);
  for (const fileId of ids.slice(0, options.files ?? ids.length)) {
    const node = await mongo.db.nodes.findFirst({ _id: fileId });
    if (!node?.ownerId) continue;
    const owner = node.ownerId;
    const removed = await mongo.transaction(async (tx) => {
      await lockTree(nodesMongo(tx), owner);
      const fresh = await tx.db.nodes.findFirst({ _id: fileId });
      if (!fresh?.currentVersionId) return 0;
      const rows = await tx.db.versions.findMany({
        filter: { fileId },
        sort: { number: -1 },
      });
      const drop = rows.filter(
        (row, index) =>
          !row._id.equals(fresh.currentVersionId ?? row._id) &&
          (index >= max || row.createdAt < cutoff),
      );
      for (const row of drop) {
        await removeVersion(tx, core, workspaceId, fresh, row);
      }
      return drop.length;
    });
    if (removed > 0) {
      report.files += 1;
      report.removed += removed;
    }
  }
  return report;
}

// Settles every active workspace, one after the other; a workspace that fails
// is reported and does not stop the others.
export async function retainAll(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
  options: RetentionOptions = {},
): Promise<{
  done: ({ workspaceId: string } & RetentionReport)[];
  failed: { workspaceId: string; error: unknown }[];
}> {
  const workspaces = await core.db.workspaces.findMany({
    filter: { status: "active" },
  });
  const done: ({ workspaceId: string } & RetentionReport)[] = [];
  const failed: { workspaceId: string; error: unknown }[] = [];
  for (const workspace of workspaces) {
    try {
      const mongo = filesMongo(await databaseOf(workspace.id));
      const report = await retainVersions(mongo, core, workspace.id, options);
      done.push({ workspaceId: workspace.id, ...report });
    } catch (error) {
      failed.push({ workspaceId: workspace.id, error });
    }
  }
  return { done, failed };
}
