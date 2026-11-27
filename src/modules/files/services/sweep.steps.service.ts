import { mediaPlace } from "@softistx/alxia-media";
import type { FilesMongo } from "../models";
import { ORPHAN_BRAKE, orphanBrake } from "../rules";
import {
  cannotAfford,
  oldKeysOf,
  removeObjects,
  type Sweep,
  type SweepBucket,
  sizesOf,
} from "../utils";

// The keys no blob records at all (a claimed key has a blob).
export async function unrecordedOf(
  run: Sweep,
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const held = await run.mongo.db.blobs.raw
    .find(
      { $or: [{ key: { $in: [...keys] } }, { crops: { $in: [...keys] } }] },
      { projection: { key: 1, crops: 1 } },
    )
    .toArray();
  // A crops key is recorded on its blob: not an orphan of its own.
  const recorded = new Set(
    held.flatMap((blob) => [blob.key, ...(blob.crops ?? [])]),
  );
  return keys.filter((key) => !recorded.has(key));
}

// The dry first pass, before any claim: lists the workspace's objects (up to
// the cap of unrecorded old keys) and answers why the workspace must not be
// swept, or null. Decided once; the claims of the run never change it.
export async function dryPass(run: Sweep): Promise<string | null> {
  const prefix = `workspaces/${run.workspaceId}/files/`;
  let unrecorded = 0;
  for (let cursor: string | null = null; unrecorded < run.max; ) {
    if (!(await run.renew())) {
      run.lost = true;
      return null;
    }
    const page: Awaited<ReturnType<SweepBucket["list"]>> =
      await run.bucket.list({ prefix, limit: run.batch, cursor });
    const { old, future } = oldKeysOf(run, page.items, prefix);
    if (future) return "an object is dated in the future (clock skew)";
    unrecorded += (await unrecordedOf(run, [...old.keys()])).length;
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  if (unrecorded < ORPHAN_BRAKE) return null;
  const recorded = await run.mongo.db.blobs.raw.countDocuments({
    refs: { $gt: 0 },
  });
  return orphanBrake(unrecorded, recorded)
    ? `${unrecorded} old keys are unrecorded against ${recorded} recorded blobs`
    : null;
}

// What still holds a blob a refs count says is free: a node or a version.
async function holderOf(mongo: FilesMongo, key: string) {
  const find = { blobKey: key };
  const projection = { projection: { _id: 1 } };
  if (await mongo.db.nodes.raw.findOne(find, projection)) return "a node";
  if (await mongo.db.versions.raw.findOne(find, projection)) return "a version";
  return null;
}

// Removes one released blob (past the grace window) with its object and
// sizes: the blob first, with a delete that only matches while `refs` is
// still 0, so a blob taken again meanwhile stays. `capped` ends the step.
export async function releaseOne(
  run: Sweep,
  key: string,
  cutoff: Date,
): Promise<"capped" | "done"> {
  const holder = await holderOf(run.mongo, key);
  if (holder !== null) {
    run.log(
      `storage sweep ${run.workspaceId}: blob ${key} has refs 0 but ${holder} still holds it, kept`,
    );
    return "done";
  }
  const objectKey = mediaPlace("files", `workspaces/${run.workspaceId}`)(key);
  const blob = await run.mongo.db.blobs.raw.findOne({ key });
  const objects = [objectKey, ...(await sizesOf(run, objectKey))];
  // The crops made for each focal point sit under their own keys.
  for (const crops of blob?.crops ?? []) {
    const cropsKey = mediaPlace(
      "files",
      `workspaces/${run.workspaceId}`,
    )(crops);
    objects.push(cropsKey, ...(await sizesOf(run, cropsKey)));
  }
  if (cannotAfford(run, objects.length)) return "capped";
  const gone = await run.mongo.db.blobs.raw.deleteOne({
    key,
    refs: 0,
    releasedAt: { $lt: cutoff },
  });
  if (gone.deletedCount === 0) return "done";
  const failed = await removeObjects(run, objects);
  run.report.failed += failed;
  if (failed === 0) run.report.released += 1;
  return "done";
}
