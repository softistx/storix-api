import { membersMongo, type Seat, seatOf } from "@/core/members";
import { roleOn } from "@/modules/shares/public";
import type { FilesMongo } from "../models";

// The most nodes whose role is asked for one key: a blob a copy shares is held
// by a handful of nodes.
const HOLDERS = 50;

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
  const holders = await mongo.db.nodes.findMany({
    filter: held,
    limit: HOLDERS,
  });
  for (const node of holders) {
    if (await roleOn(mongo, who, node)) return true;
  }
  return false;
}
