import {
  DEFAULT_SETTINGS,
  settingsOf,
  type WorkspacesMongo,
} from "@/core/workspaces";
import type { FilesMongo } from "@/modules/files/public";
import { filesMongo } from "@/modules/files/public";
import { purgeEntry } from "./trash.purge";

const DAY_MS = 86_400_000;

// The most entries one run purges per workspace (the next run takes the rest).
const ENTRIES_PER_RUN = 500;

export interface TrashRetentionOptions {
  days?: number;
  now?: () => Date;
  entries?: number;
}

export interface TrashRetentionReport {
  entries: number;
  removed: number;
}

// Purges what has been in the trash longer than the workspace's `trashDays`
// (a run may pass `days`): each entry older than that, with its subtree, in a
// transaction of its own under its owner's tree lock (see `purgeEntry`). The
// blobs are released and the quota freed as for a purge by hand; the sweep
// removes the objects. An entry restored meanwhile is skipped.
export async function retainTrash(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  options: TrashRetentionOptions = {},
): Promise<TrashRetentionReport> {
  const settings = await settingsOf(core, workspaceId);
  const days =
    options.days ?? settings?.trashDays ?? DEFAULT_SETTINGS.trashDays;
  const cutoff = new Date(
    (options.now ?? (() => new Date()))().getTime() - days * DAY_MS,
  );
  const due = await mongo.db.nodes.raw
    .find(
      { trashedAt: { $lt: cutoff }, trashRootId: null },
      { projection: { _id: 1, ownerId: 1 } },
    )
    .sort({ trashedAt: 1 })
    .limit(options.entries ?? ENTRIES_PER_RUN)
    .toArray();
  const report: TrashRetentionReport = { entries: 0, removed: 0 };
  for (const entry of due) {
    try {
      const done = await purgeEntry(mongo, core, {
        workspaceId,
        accountId: String(entry.ownerId),
        id: entry._id.toHexString(),
      });
      report.entries += 1;
      report.removed += done.removed;
    } catch {
      // Gone (an outer entry purged first) or restored since the list was read.
    }
  }
  return report;
}

// Settles every active workspace, one after the other; a workspace that fails
// is reported and does not stop the others.
export async function retainTrashAll(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
  options: TrashRetentionOptions = {},
): Promise<{
  done: ({ workspaceId: string } & TrashRetentionReport)[];
  failed: { workspaceId: string; error: unknown }[];
}> {
  const workspaces = await core.db.workspaces.findMany({
    filter: { status: "active" },
  });
  const done: ({ workspaceId: string } & TrashRetentionReport)[] = [];
  const failed: { workspaceId: string; error: unknown }[] = [];
  for (const workspace of workspaces) {
    try {
      const mongo = filesMongo(await databaseOf(workspace.id));
      const report = await retainTrash(mongo, core, workspace.id, options);
      done.push({ workspaceId: workspace.id, ...report });
    } catch (error) {
      failed.push({ workspaceId: workspace.id, error });
    }
  }
  return { done, failed };
}
