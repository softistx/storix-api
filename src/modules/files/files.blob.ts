import { ConflictError } from "@softistx/mongo";
import type { FilesMongo } from "./files.handle";

// A key that a blob already holds, raised inside the transaction so that the
// node's own `ConflictError` (`name-taken`) is not mistaken for it.
export class KeyRecorded extends Error {}

// Records an uploaded object as a blob held `refs` times: 2 for a file or a
// version recorded with its node (the node and the version row each hold it).
// `KeyRecorded` when a blob already holds the key.
export async function recordBlob(
  tx: FilesMongo,
  key: string,
  object: { size: number; mimeType: string },
  refs = 2,
) {
  if (await tx.db.blobs.findFirst({ key })) throw new KeyRecorded();
  try {
    await tx.db.blobs.create({ key, ...object, refs });
  } catch (error) {
    // Two recorders of one key at once: the unique index settles it.
    if (error instanceof ConflictError) throw new KeyRecorded();
    throw error;
  }
}

// Lets go of `count` holds on a blob; the blob a last hold leaves is released
// (the sweep removes it and its object). Answers the refs left.
export async function releaseBlob(
  tx: FilesMongo,
  key: string,
  count = 1,
): Promise<number> {
  await tx.db.blobs.updateMany({ key }, { $inc: { refs: -count } });
  const blob = await tx.db.blobs.findFirst({ key });
  const left = blob?.refs ?? 0;
  if (blob && left === 0) {
    await tx.db.blobs.updateMany({ key, refs: 0 }, { releasedAt: new Date() });
  }
  return left;
}

// Lets go of several blobs' holds at once (`counts`: key to holds released),
// as `releaseBlob` does for one; the blobs a last hold leaves are released.
export async function releaseBlobs(
  tx: FilesMongo,
  counts: ReadonlyMap<string, number>,
): Promise<void> {
  for (const [key, count] of counts) await releaseBlob(tx, key, count);
}
