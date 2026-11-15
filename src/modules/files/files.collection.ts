import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";

// One stored object of the `files` kind, recorded once (plan §3.3). `key` is
// the media key (`workspaces/<id>/files/<key>` in the bucket); `size` and
// `mimeType` are the storage's, never the caller's. `refs` counts the nodes
// (and, later, versions and copies) that hold the object: a copy shares the
// blob, and the orphan sweep removes it once `refs` is 0 and `releasedAt` is
// set.
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
