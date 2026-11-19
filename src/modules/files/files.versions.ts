import type { MediaBucket } from "@alxia/media";
import { tryObjectId } from "@softistx/mongo";
import type { WorkspacesMongo } from "@/core/workspaces";
import { fail } from "@/i18n/fail";
import {
  lockTree,
  type NodeDoc,
  named,
  nodeNotFound,
  nodesMongo,
  ownedNode,
} from "@/modules/nodes/public";
import { accounted } from "./files.accounting";
import { KeyRecorded, releaseBlob } from "./files.blob";
import { enqueue } from "./files.enqueue";
import { keyUnknown, notAFile } from "./files.errors";
import type { FilesMongo } from "./files.handle";
import { discardObject, storedObject } from "./files.object";
import { type RenditionsQueue, renditionKindOf } from "./files.renditions";
import { isQuotaExceeded } from "./files.service";
import { ensureVersions } from "./files.versions.first";
import { pushVersion } from "./files.versions.push";

export type VersionDoc = Awaited<
  ReturnType<FilesMongo["db"]["versions"]["getById"]>
>;

export const versionNotFound = () =>
  fail("versions.errors.not-found", { status: 404, field: "versionId" });
export const isCurrent = () =>
  fail("versions.errors.is-current", { status: 409, field: "versionId" });

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
