import { membersMongo, type Seat, seatOf } from "@/core/members";
import { grantedNodeIds } from "@/modules/shares/public";
import type { FilesMongo } from "../models";

// Whether the account may read a `files` object: a live node holds the key, as
// its blob or as one of its versions', and the caller reaches it as a viewer at
// least (their own tree, or a share on it or a folder above it). A revoked
// grant ends the access on the next read.
export async function mayRead(
  mongo: FilesMongo,
  read: { key: string; accountId: string; workspaceId: string; core: unknown },
): Promise<boolean> {
  const seat: Seat | null = await seatOf(
    membersMongo(read.core),
    read.workspaceId,
    read.accountId,
  );
  const who = seat ?? read.accountId;
  const fileIds = await mongo.db.versions.raw.distinct("fileId", {
    blobKey: read.key,
  });
  const held = {
    trashedAt: null,
    $or: [{ blobKey: read.key }, { _id: { $in: fileIds } }],
  };
  if (await mongo.db.nodes.findFirst({ ...held, ownerId: read.accountId })) {
    return true;
  }
  const granted = await grantedNodeIds(mongo, who);
  if (granted.length === 0) return false;
  const reached = await mongo.db.nodes.findFirst({
    $and: [
      held,
      { $or: [{ _id: { $in: granted } }, { ancestors: { $in: granted } }] },
    ],
  });
  return reached !== null;
}
