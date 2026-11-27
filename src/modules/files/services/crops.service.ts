import { type MediaBucket, mediaPlace } from "@softistx/alxia-media";
import type { FilesMongo } from "../models";
import { CROP_SIZES, cropsKeyOf, type Focal } from "../rules";
import type { MadeRendition } from "../utils";

export interface CropsDeps {
  mongo: FilesMongo;
  bucket: MediaBucket;
}

// Stores the sizes where `GET /media/files/<key>/<size>` serves them: the
// previews under the blob's key, the four crops under the key of the focal
// point they were made for (`cropsKeyOf`). That key is recorded on the blob
// first, so the sweep and the read check know it before an object exists.
export async function storeRenditions(
  deps: CropsDeps,
  job: { workspaceId: string; key: string; focal: Focal | null | undefined },
  made: MadeRendition[],
) {
  const place = mediaPlace("files", `workspaces/${job.workspaceId}`);
  const cropsKey = cropsKeyOf(job.key, job.focal);
  if (cropsKey !== job.key) {
    await deps.mongo.db.blobs.raw.updateOne(
      { key: job.key },
      { $addToSet: { crops: cropsKey } },
    );
  }
  for (const one of made) {
    const owner = (CROP_SIZES as readonly string[]).includes(one.size)
      ? cropsKey
      : job.key;
    await deps.bucket.put({ key: place(owner, one.size) }, one.bytes, {
      type: one.contentType,
    });
  }
}

// Forgets and deletes the crops of the focal points no node of the blob uses
// any more: a node uses the crops it settled (`cropsKey`, the blob's own key
// when absent) and those of the point it waits for (`focalPoint`). The blob's
// own key is never removed. Run after a job settled; a failed delete leaves
// objects the orphan scan of the storage sweep removes.
//
// A key a move made live again meanwhile is never lost: the keys are
// forgotten first, the nodes are read again, and a key they use now is
// recorded back and kept (its job rewrites the objects that are missing).
export async function pruneCrops(
  deps: CropsDeps,
  workspaceId: string,
  key: string,
) {
  const blobs = deps.mongo.db.blobs.raw;
  const blob = await blobs.findOne({ key }, { projection: { crops: 1 } });
  if (!blob?.crops?.length) return [];
  const live = await liveCrops(deps, key);
  const stale = blob.crops.filter((one) => !live.has(one));
  if (stale.length === 0) return [];
  await blobs.updateOne({ key }, { $pull: { crops: { $in: stale } } });
  const again = await liveCrops(deps, key);
  const revived = stale.filter((one) => again.has(one));
  if (revived.length > 0) {
    await blobs.updateOne(
      { key },
      { $addToSet: { crops: { $each: revived } } },
    );
  }
  const gone = stale.filter((one) => !again.has(one));
  const place = mediaPlace("files", `workspaces/${workspaceId}`);
  for (const one of gone) {
    for (const size of CROP_SIZES) {
      await deps.bucket.delete({ key: place(one, size) }).catch(() => {});
    }
  }
  return gone;
}

// The crops keys a node of the blob serves or waits for, trashed nodes too.
async function liveCrops({ mongo }: CropsDeps, key: string) {
  const nodes = await mongo.db.nodes.raw
    .find({ blobKey: key }, { projection: { cropsKey: 1, focalPoint: 1 } })
    .toArray();
  const live = new Set([key]);
  for (const node of nodes) {
    live.add(node["cropsKey"] ?? key);
    live.add(cropsKeyOf(key, node["focalPoint"]));
  }
  return live;
}
