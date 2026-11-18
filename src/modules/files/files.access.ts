import type { FilesMongo } from "./files.handle";

// Whether the account may read a `files` object: a live node of their own
// tree holds the key, as its blob or as one of its versions' (sharing widens
// this one question later).
export async function mayRead(
  mongo: FilesMongo,
  read: { key: string; accountId: string },
): Promise<boolean> {
  const own = { ownerId: read.accountId, trashedAt: null };
  if (await mongo.db.nodes.findFirst({ blobKey: read.key, ...own })) {
    return true;
  }
  const fileIds = await mongo.db.versions.raw.distinct("fileId", {
    blobKey: read.key,
  });
  if (fileIds.length === 0) return false;
  const node = await mongo.db.nodes.findFirst({
    _id: { $in: fileIds },
    ...own,
  });
  return node !== undefined;
}
