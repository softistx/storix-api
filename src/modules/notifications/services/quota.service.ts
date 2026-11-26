import { toObjectId } from "@softistx/mongo";
import { isDuplicateKey } from "@/core/shared/mongo-errors.utils";
import type { NotificationsMongo } from "../models";
import type { QuotaLevel } from "../utils";

// Claims a quota threshold for a workspace: true for the one caller that
// crosses it first, false when the workspace was already told of it (or of a
// higher one). The mark is lowered as soon as the usage is seen under the
// threshold, so a later crossing tells again: once per crossing, however many
// uploads race (the unique index on the workspace settles a first claim, the
// `level` filter every later one).
export async function claimLevel(
  mongo: NotificationsMongo,
  workspaceId: string,
  level: QuotaLevel,
): Promise<boolean> {
  const filter = { workspaceId: toObjectId(workspaceId) };
  // A typed read first: only the package's own methods wait for the first
  // sync, which creates the unique index the claim below relies on (`raw` does
  // not wait for it).
  await mongo.db.quotaMarks.findFirst(filter);
  const marks = mongo.db.quotaMarks.raw;
  const now = new Date();
  await marks.updateOne(
    { ...filter, level: { $gt: level } },
    { $set: { level, updatedAt: now } },
  );
  if (level === 0) return false;
  try {
    const claimed = await marks.updateOne(
      { ...filter, level: { $lt: level } },
      { $set: { level, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return claimed.modifiedCount + claimed.upsertedCount > 0;
  } catch (error) {
    // The mark already holds this level or a higher one: the unique index
    // refused the insert the filter could not match.
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}
