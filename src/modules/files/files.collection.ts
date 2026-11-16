import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// One stored object of the `files` kind, recorded once (plan §3.3). `key` is
// the media key (`workspaces/<id>/files/<key>` in the bucket); `size` and
// `mimeType` are the storage's, never the caller's. `refs` counts the nodes
// (and, later, versions and copies) that hold the object: a copy shares the
// blob, and the orphan sweep removes it once `refs` is 0 (`releasedAt` is
// set for E3 to use).
export const blobs = defineCollection({
  name: "blobs",
  schema: z.object({
    _id: id(),
    key: z.string().min(1),
    size: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    refs: z.number().int().nonnegative().default(1),
    releasedAt: z.date().nullable().default(null),
  }),
  timestamps: true,
  indexes: [
    // A key is recorded once: a second `addFile` of it is refused.
    { key: { key: 1 }, unique: true, name: "blobs_key_unique" },
    { key: { refs: 1, releasedAt: 1 }, name: "blobs_released" },
  ],
});

// A member's favourite: one document per account and node (plan §3.3), made
// by `setStarred`. The node is whichever of the caller's tree it names;
// whether it still counts (live, still readable) is decided when the list is
// read, so a trash or an unshare needs no write here. `createdAt` is when it
// was starred, the order of the list.
export const stars = defineCollection({
  name: "stars",
  schema: z.object({
    _id: id(),
    accountId: z.string().min(1),
    nodeId: objectId(),
  }),
  timestamps: true,
  indexes: [
    { key: { accountId: 1, nodeId: 1 }, unique: true, name: "stars_unique" },
    { key: { accountId: 1, createdAt: -1, _id: -1 }, name: "stars_listing" },
    { key: { nodeId: 1 }, name: "stars_node" },
  ],
});

// A file a member opened or uploaded lately: one document per account and
// file, `at` the last time. Capped at `MAX_RECENTS` per account when one is
// recorded (`files.recents.ts`).
export const recents = defineCollection({
  name: "recents",
  schema: z.object({
    _id: id(),
    accountId: z.string().min(1),
    nodeId: objectId(),
    at: z.date(),
  }),
  indexes: [
    { key: { accountId: 1, nodeId: 1 }, unique: true, name: "recents_unique" },
    { key: { accountId: 1, at: -1, _id: -1 }, name: "recents_listing" },
    { key: { nodeId: 1 }, name: "recents_node" },
  ],
});
