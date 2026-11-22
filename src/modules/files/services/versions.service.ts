import type { MediaBucket } from "@softistx/alxia-media";
import { tryObjectId } from "@softistx/mongo";
import {
  DEFAULT_SETTINGS,
  settingsOf,
  type WorkspacesMongo,
} from "@/core/workspaces";
import {
  familyOf,
  lockTree,
  type NodeDoc,
  named,
  nodeNotFound,
  nodesMongo,
  ownedNode,
} from "@/modules/nodes/public";
import {
  isCurrent,
  keyUnknown,
  notAFile,
  versionNotFound,
} from "../files.errors";
import type { FilesMongo } from "../models";
import { filesMongo } from "../models";
import { type RenditionsQueue, renditionKindOf } from "../rules";
import { discardObject, isQuotaExceeded, storedObject } from "../utils";
import { accounted } from "./accounting.service";
import { KeyRecorded, recordBlob, releaseBlob } from "./blob.service";
import { enqueue } from "./enqueue.service";

// The row for the blob a file holds now, as its version 1, made in the caller's transaction. A file that
// `addFile` recorded gets it at once; a file recorded before versions existed,
// or a copy, gets it here the first time a version is read or changed. The
// blob's `refs` is the caller's: `addFile` creates the blob already held by
// the row; `ensureVersions` raises it.
export async function makeFirstVersion(
  tx: FilesMongo,
  node: NodeDoc,
  createdBy: string,
): Promise<NodeDoc> {
  const row = await tx.db.versions.create({
    fileId: node._id,
    number: 1,
    blobKey: node.blobKey ?? "",
    size: node.size ?? 0,
    mimeType: node.mimeType ?? "application/octet-stream",
    createdBy,
  });
  // Silent: the file's own `version` is what a client holds for a rename.
  await tx.db.nodes.updateMany(
    { _id: node._id },
    { currentVersionId: row._id },
    { audit: false },
  );
  return { ...node, currentVersionId: row._id };
}

// The file with a current version: a file made before versions existed gets
// its version 1 holding the blob it has, and that blob one more hold.
export async function ensureVersions(
  tx: FilesMongo,
  node: NodeDoc,
): Promise<NodeDoc> {
  if (node.currentVersionId || !node.blobKey) return node;
  const made = await makeFirstVersion(tx, node, node.ownerId ?? "");
  await tx.db.blobs.updateMany({ key: node.blobKey }, { $inc: { refs: 1 } });
  return made;
}

// What a new current version holds: the blob (`fresh` when it is an upload
// just recorded, else a blob a version of this file already holds), how its
// previews stand, and where it came from.
export interface Pushed {
  workspaceId: string;
  accountId: string;
  blob: { key: string; size: number; mimeType: string };
  fresh: boolean;
  status: "READY" | "PROCESSING";
  note: string | null;
  restoredFrom: number | null;
}

// Appends a version to a file and makes it current, in the caller's
// transaction (which holds the tree lock: `lockTree`). The number is the last
// one plus 1, read under that lock, so two writers never take the same one and
// a rolled-back transaction leaves no gap. The file's previous blob stays held
// by its version row; a restored blob is held once more (no object is made);
// a fresh blob is recorded and counts in the quota (`quotas.errors.exceeded`).
// The counters follow who holds each blob (`accounted`). A new picture
// starts with the centre as its focal point. Answers the file as it is now.
export async function pushVersion(
  tx: FilesMongo,
  core: WorkspacesMongo,
  node: NodeDoc,
  input: Pushed,
): Promise<{ node: NodeDoc; number: number }> {
  const file = await ensureVersions(tx, node);
  const before = file.blobKey ?? "";
  return accounted(
    tx,
    core,
    input.workspaceId,
    [before, input.blob.key],
    async () => {
      const [last] = await tx.db.versions.findMany({
        filter: { fileId: file._id },
        sort: { number: -1 },
        limit: 1,
      });
      const number = (last?.number ?? 0) + 1;
      if (input.fresh) {
        await recordBlob(tx, input.blob.key, input.blob, 2);
      } else {
        await tx.db.blobs.updateMany(
          { key: input.blob.key },
          { $inc: { refs: 2 } },
        );
      }
      const row = await tx.db.versions.create({
        fileId: file._id,
        number,
        blobKey: input.blob.key,
        size: input.blob.size,
        mimeType: input.blob.mimeType,
        createdBy: input.accountId,
        note: input.note,
        restoredFrom: input.restoredFrom,
      });
      const updated = await tx.db.nodes.as(input.accountId).update(file._id, {
        blobKey: input.blob.key,
        mimeType: input.blob.mimeType,
        size: input.blob.size,
        family: familyOf(input.blob.mimeType),
        status: input.status,
        // A new blob starts its renditions afresh.
        renditionRequeues: 0,
        ...(input.status === "PROCESSING" && { renditionsAt: new Date() }),
        currentVersionId: row._id,
        ...(input.fresh && { focalPoint: null }),
      });
      // The node no longer holds its previous blob; its version row does.
      await releaseBlob(tx, before, 1);
      return { node: updated, number };
    },
  );
}

export type VersionDoc = Awaited<
  ReturnType<FilesMongo["db"]["versions"]["getById"]>
>;

// The file of the caller's tree, in the transaction: 404 for a node that is
// not theirs or is trashed, `not-a-file` for a folder.
async function liveFile(tx: FilesMongo, id: string, accountId: string) {
  const node = await ownedNode(nodesMongo(tx), id, accountId);
  if (node.trashedAt) throw nodeNotFound();
  if (node.type !== "FILE" || !node.blobKey) throw notAFile();
  return node;
}

async function versionOf(tx: FilesMongo, node: NodeDoc, versionId: string) {
  const _id = tryObjectId(versionId);
  const row =
    _id && (await tx.db.versions.findFirst({ _id, fileId: node._id }));
  if (!row) throw versionNotFound();
  return row;
}

// The versions of a file of the caller's tree, newest first, and the id of the
// current one. A file recorded before versions existed (or a copy) gets its
// version 1 here, once.
export async function listVersions(
  mongo: FilesMongo,
  input: { id: string; accountId: string },
): Promise<{ rows: VersionDoc[]; currentId: string | null }> {
  const node = await ownedNode(nodesMongo(mongo), input.id, input.accountId);
  if (node.type !== "FILE") throw notAFile();
  if (node.trashedAt) throw nodeNotFound();
  const current = node.currentVersionId
    ? node
    : await mongo.transaction(async (tx) => {
        await lockTree(nodesMongo(tx), input.accountId);
        const fresh = await liveFile(tx, input.id, input.accountId);
        return ensureVersions(tx, fresh);
      });
  const rows = await mongo.db.versions.findMany({
    filter: { fileId: node._id },
    sort: { number: -1 },
  });
  return { rows, currentId: current.currentVersionId?.toHexString() ?? null };
}

// Puts an uploaded object (the key `PUT /media/files` answered) into a file as
// its new current version. `key-unknown` as `addFile`, `quotas.errors.exceeded`
// (the object is deleted), `nodes.errors.not-found`, `files.errors.not-a-file`.
// Pictures and PDFs are `PROCESSING` until the worker has made their sizes.
// Answers the file as it is now, as it was, and the new number.
export async function addVersion(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  bucket: MediaBucket | undefined,
  renditions: RenditionsQueue | undefined,
  input: {
    workspaceId: string;
    accountId: string;
    id: string;
    key: string;
    note: string | null;
  },
): Promise<{ node: NodeDoc; before: NodeDoc; number: number }> {
  const object = await storedObject(bucket, input.workspaceId, input.key);
  const rendered = renditions && renditionKindOf(object.mimeType) !== null;
  try {
    const done = await named(() =>
      mongo.transaction(async (tx) => {
        await lockTree(nodesMongo(tx), input.accountId);
        const before = await liveFile(tx, input.id, input.accountId);
        const pushed = await pushVersion(tx, core, before, {
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          blob: { key: input.key, ...object },
          fresh: true,
          status: rendered ? "PROCESSING" : "READY",
          note: input.note,
          restoredFrom: null,
        });
        return { ...pushed, before };
      }),
    );
    const node = rendered
      ? await enqueue(
          mongo,
          renditions,
          { workspaceId: input.workspaceId, key: input.key },
          done.node,
        )
      : done.node;
    return { ...done, node };
  } catch (error) {
    if (error instanceof KeyRecorded) throw keyUnknown();
    if (isQuotaExceeded(error)) {
      await discardObject(bucket, input.workspaceId, input.key);
    }
    throw error;
  }
}

// Makes a new current version that holds the blob of an older one: the object
// is shared (`blobs.refs`), so none is stored and the quota is untouched. The
// older version stays in the list. `not-found` for a version this file does
// not have, `is-current` for the current one. A picture or a PDF has its sizes
// made again (they are the blob's, so the same ones are written).
export async function restoreVersion(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  renditions: RenditionsQueue | undefined,
  input: {
    workspaceId: string;
    accountId: string;
    id: string;
    versionId: string;
    note: string | null;
  },
): Promise<{ node: NodeDoc; before: NodeDoc; from: number; number: number }> {
  const done = await named(() =>
    mongo.transaction(async (tx) => {
      await lockTree(nodesMongo(tx), input.accountId);
      const before = await ensureVersions(
        tx,
        await liveFile(tx, input.id, input.accountId),
      );
      const source = await versionOf(tx, before, input.versionId);
      if (before.currentVersionId?.equals(source._id)) throw isCurrent();
      const rendered = renditions && renditionKindOf(source.mimeType) !== null;
      const pushed = await pushVersion(tx, core, before, {
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        blob: {
          key: source.blobKey,
          size: source.size,
          mimeType: source.mimeType,
        },
        fresh: false,
        status: rendered ? "PROCESSING" : "READY",
        note: input.note,
        restoredFrom: source.number,
      });
      return { ...pushed, before, from: source.number, rendered };
    }),
  );
  const node = done.rendered
    ? await enqueue(
        mongo,
        renditions as RenditionsQueue,
        { workspaceId: input.workspaceId, key: done.node.blobKey ?? "" },
        done.node,
        crypto.randomUUID(),
      )
    : done.node;
  return { ...done, node };
}

// Removes one version row in the caller's transaction (`lockTree` taken): its
// hold on the blob is let go, the blob is released when it was the last, and
// the counters follow: a blob nothing holds leaves `bytes` and
// `versionBytes`. The current version is refused (`is-current`).
export async function removeVersion(
  tx: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  node: NodeDoc,
  row: VersionDoc,
) {
  if (node.currentVersionId?.equals(row._id)) throw isCurrent();
  await accounted(tx, core, workspaceId, [row.blobKey], async () => {
    await tx.db.versions.deleteMany({ _id: row._id });
    await releaseBlob(tx, row.blobKey, 1);
  });
}

// Deletes a non-current version of a file of the caller's tree. `not-found`,
// `is-current`. Answers the file and the number removed.
export async function deleteVersion(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: {
    workspaceId: string;
    accountId: string;
    id: string;
    versionId: string;
  },
): Promise<{ node: NodeDoc; number: number }> {
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTree(nodesMongo(tx), input.accountId);
      const node = await ensureVersions(
        tx,
        await liveFile(tx, input.id, input.accountId),
      );
      const row = await versionOf(tx, node, input.versionId);
      await removeVersion(tx, core, input.workspaceId, node, row);
      return { node, number: row.number };
    }),
  );
}

const DAY_MS = 86_400_000;

// The most files one run settles per workspace (the next run takes the rest).
const FILES_PER_RUN = 500;

// `max` and `days` default to the workspace's settings (`versionsMax`,
// `versionsDays`); a run may pass others.
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
  // Files whose versions could not be dropped; the next run tries them again.
  failed: number;
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
  const settings = await settingsOf(core, workspaceId);
  const max =
    options.max ?? settings?.versionsMax ?? DEFAULT_SETTINGS.versionsMax;
  const days =
    options.days ?? settings?.versionsDays ?? DEFAULT_SETTINGS.versionsDays;
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const report: RetentionReport = { files: 0, removed: 0, failed: 0 };
  const ids = await candidates(mongo, cutoff, max);
  for (const fileId of ids.slice(0, options.files ?? ids.length)) {
    try {
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
    } catch (error) {
      // One bad file does not stop the workspace: it is counted and logged, and
      // the next run takes it again.
      report.failed += 1;
      console.error(
        `version retention: file ${fileId.toHexString()} of workspace ${workspaceId} not settled:`,
        error,
      );
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
