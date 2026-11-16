import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import { familyOf, type NodeDoc } from "@/modules/nodes/public";
import { recordBlob, releaseBlob } from "./files.blob";
import type { FilesMongo } from "./files.service";
import { ensureVersions } from "./files.versions.first";

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

const heldByNode = async (tx: FilesMongo, key: string) =>
  (await tx.db.nodes.count({ blobKey: key })) > 0;

// Appends a version to a file and makes it current, in the caller's
// transaction (which holds the tree lock: `lockTree`). The number is the last
// one plus 1, read under that lock, so two writers never take the same one and
// a rolled-back transaction leaves no gap. The file's previous blob stays held
// by its version row; a restored blob is held once more (no object is made);
// a fresh blob is recorded and counts in the quota (`quotas.errors.exceeded`).
// `versionBytes` follows the blobs that only versions hold. A new picture
// starts with the centre as its focal point. Answers the file as it is now.
export async function pushVersion(
  tx: FilesMongo,
  core: WorkspacesMongo,
  node: NodeDoc,
  input: Pushed,
): Promise<{ node: NodeDoc; number: number }> {
  const file = await ensureVersions(tx, node);
  const before = file.blobKey ?? "";
  const [last] = await tx.db.versions.findMany({
    filter: { fileId: file._id },
    sort: { number: -1 },
    limit: 1,
  });
  const number = (last?.number ?? 0) + 1;
  // Held by no node before: a restored blob counted in `versionBytes` since.
  const wasVersionOnly =
    !input.fresh && !(await heldByNode(tx, input.blob.key));
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
    currentVersionId: row._id,
    ...(input.fresh && { focalPoint: null }),
  });
  // The node no longer holds its previous blob; its version row does.
  // (Restoring a version of the very blob the file holds changes no bytes.)
  await releaseBlob(tx, before, 1);
  let versionBytes = 0;
  if (before !== input.blob.key) {
    if (!(await heldByNode(tx, before))) versionBytes += file.size ?? 0;
    if (wasVersionOnly) versionBytes -= input.blob.size;
  }
  await addUsage(core.withSession(tx.session), input.workspaceId, {
    bytes: input.fresh ? input.blob.size : 0,
    files: 0,
    versionBytes,
  });
  return { node: updated, number };
}
