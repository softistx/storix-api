import { isDuplicateKey } from "@/core/shared/mongo-errors.utils";
import type { FilesMongo } from "../models";

/** A sweep's lock expires this long after it was taken (a crashed run). */
export const SWEEP_LOCK_MS = 30 * 60_000;

const LOCK_ID = "sweep" as const;

// Takes the workspace's sweep lock for `ttlMs` and answers the holder's token,
// or null when another run holds it. The lock is one document: an update takes
// an expired one (atomic, one winner), the insert takes an absent one (the
// `_id` makes the loser a duplicate key). Two runs started together therefore
// never both hold it.
export async function takeSweepLock(
  mongo: FilesMongo,
  now: Date,
  ttlMs: number = SWEEP_LOCK_MS,
): Promise<string | null> {
  const locks = mongo.db.sweepLocks.raw;
  const heldBy = crypto.randomUUID();
  const until = new Date(now.getTime() + ttlMs);
  const taken = await locks.updateOne(
    { _id: LOCK_ID, until: { $lte: now } },
    { $set: { heldBy, until } },
  );
  if (taken.modifiedCount === 1) return heldBy;
  try {
    await locks.insertOne({ _id: LOCK_ID, heldBy, until });
    return heldBy;
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

// Pushes the lease out by `ttlMs` between a sweep's steps, only while it is
// still this holder's. False means the run lost it (it overran its ttl and
// another run took over): it must stop acting.
export async function renewSweepLock(
  mongo: FilesMongo,
  heldBy: string,
  now: Date,
  ttlMs: number = SWEEP_LOCK_MS,
): Promise<boolean> {
  const renewed = await mongo.db.sweepLocks.raw.updateOne(
    { _id: LOCK_ID, heldBy },
    { $set: { until: new Date(now.getTime() + ttlMs) } },
  );
  return renewed.matchedCount === 1;
}

// Gives the lock back, only while it is still this holder's: a run that
// overran its ttl must not free the lock another run took over.
export async function giveSweepLockBack(
  mongo: FilesMongo,
  heldBy: string,
): Promise<void> {
  await mongo.db.sweepLocks.raw.deleteOne({ _id: LOCK_ID, heldBy });
}
