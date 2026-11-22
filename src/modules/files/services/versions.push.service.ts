import type { WorkspacesMongo } from "@/core/workspaces";
import { familyOf, type NodeDoc } from "@/modules/nodes/public";
import type { FilesMongo } from "../models";
import { accounted } from "./accounting.service";
import { recordBlob, releaseBlob } from "./blob.service";
import { ensureVersions } from "./versions.first.service";

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
