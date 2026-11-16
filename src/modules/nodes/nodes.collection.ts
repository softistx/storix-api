import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// How names are compared: case does not tell two names apart (`Photos` and
// `photos` are one), accents still do. The unique index and every lookup by
// name use it.
export const NAME_COLLATION = { locale: "en", strength: 2 } as const;

export const nodeTypes = ["FOLDER", "FILE"] as const;

// What a file is, from its content type (`nodes.family.ts`); null for a folder.
export const fileFamilies = [
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "PDF",
  "DOCUMENT",
  "SPREADSHEET",
  "PRESENTATION",
  "ARCHIVE",
  "CODE",
  "OTHER",
] as const;

export const fileStatuses = ["READY", "PROCESSING", "FAILED"] as const;

// The tree of a workspace: folders now, files from the files module, one
// collection (plan §3.3). `parentId` is null for a root; `ancestors` lists the
// ids from the root down to the parent, so "everything under this folder" is
// one index read. `ownerId` is the account that owns the root the node sits
// under (plan §3.6); `spaceId`, for an API key's app space, is null until the
// api-keys slice. `treeRev` is raised by every write that changes the shape of
// the tree under a folder; `version` is the optimistic lock a rename carries.
// A file (the `files` module records it) also holds the key of its blob, its
// content type and size as the storage reported them, its family, its tags and
// its free metadata; all of these are null (or empty) on a folder.
export const nodes = defineCollection({
  name: "nodes",
  schema: z.object({
    _id: id(),
    type: z.enum(nodeTypes),
    name: z.string().min(1).max(255),
    parentId: objectId().nullable().default(null),
    ancestors: z.array(objectId()).default([]),
    ownerId: z.string().nullable().default(null),
    spaceId: z.string().nullable().default(null),
    treeRev: z.number().int().default(0),
    // In the trash since this date (the trash module, plan §3.9). A trashed
    // folder trashes everything under it: the folder is the trash's entry
    // (`trashRootId` null) and what was under it points back at it.
    trashedAt: z.date().nullable().default(null),
    trashedBy: z.string().nullable().default(null),
    trashRootId: objectId().nullable().default(null),
    blobKey: z.string().nullable().default(null),
    mimeType: z.string().nullable().default(null),
    size: z.number().int().nonnegative().nullable().default(null),
    family: z.enum(fileFamilies).nullable().default(null),
    tags: z.array(z.string()).default([]),
    meta: z.record(z.string(), z.unknown()).default({}),
    status: z.enum(fileStatuses).nullable().default(null),
    // The focal point of a picture, fractions of it from the top left (0 to 1);
    // null is the centre. Every node of a shared blob holds the same one.
    focalPoint: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .nullable()
      .default(null),
    // The version row (`versions`, the files module) whose blob the node
    // holds; null on a file recorded before versions existed or copied, until
    // its first version is made (`files.versions.first.ts`).
    currentVersionId: objectId().nullable().default(null),
  }),
  timestamps: true,
  optimisticLock: true,
  actors: { type: z.string() },
  indexes: [
    // Names are unique among the live siblings, ignoring case (plan §3.3).
    // `ownerId` and `spaceId` keep two members' roots, both called "My files",
    // from meeting.
    {
      key: { parentId: 1, ownerId: 1, spaceId: 1, name: 1 },
      unique: true,
      name: "nodes_sibling_name_unique",
      collation: NAME_COLLATION,
      partialFilterExpression: { trashedAt: { $type: "null" } },
    },
    // A member has one root.
    {
      key: { ownerId: 1 },
      unique: true,
      name: "nodes_member_root_unique",
      partialFilterExpression: {
        parentId: { $type: "null" },
        ownerId: { $type: "string" },
        trashedAt: { $type: "null" },
      },
    },
    // The listings by name, size and kind (`nodes.list.ts`): folders first
    // (`type` descending, as every sort of the listing), then the field, the
    // name and the id. The name sorts with `NAME_COLLATION`, so the indexes
    // carry it: without it MongoDB sorts a big folder in memory. A change to
    // one of them is a migration too (2026-11-15-nodes-listing-collation).
    {
      key: { parentId: 1, type: -1, name: 1, _id: 1 },
      name: "nodes_listing",
      collation: NAME_COLLATION,
    },
    { key: { ancestors: 1 }, name: "nodes_ancestors" },
    // The trash of a member: its entries, latest first.
    {
      key: { ownerId: 1, trashedAt: -1, _id: -1 },
      name: "nodes_trash",
      partialFilterExpression: { trashedAt: { $type: "date" } },
    },
    // What a trash entry took with it.
    {
      key: { trashRootId: 1 },
      name: "nodes_trash_root",
      partialFilterExpression: { trashRootId: { $type: "objectId" } },
    },
    { key: { ownerId: 1, parentId: 1 }, name: "nodes_owner_parent" },
    // The date sort has no name in its key: no collation.
    {
      key: { parentId: 1, type: -1, updatedAt: 1, _id: 1 },
      name: "nodes_listing_date",
    },
    {
      key: { parentId: 1, type: -1, size: 1, name: 1, _id: 1 },
      name: "nodes_listing_size",
      collation: NAME_COLLATION,
    },
    {
      key: { parentId: 1, type: -1, family: 1, name: 1, _id: 1 },
      name: "nodes_listing_kind",
      collation: NAME_COLLATION,
    },
    { key: { tags: 1 }, name: "nodes_tags" },
    {
      key: { blobKey: 1 },
      name: "nodes_blob_key",
      partialFilterExpression: { blobKey: { $type: "string" } },
    },
  ],
});
