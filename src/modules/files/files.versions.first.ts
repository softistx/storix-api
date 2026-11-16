import type { NodeDoc } from "@/modules/nodes/public";
import type { FilesMongo } from "./files.service";

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
