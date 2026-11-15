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
    trashedAt: z.date().nullable().default(null),
    blobKey: z.string().nullable().default(null),
    mimeType: z.string().nullable().default(null),
    size: z.number().int().nonnegative().nullable().default(null),
    family: z.enum(fileFamilies).nullable().default(null),
    tags: z.array(z.string()).default([]),
    meta: z.record(z.string(), z.unknown()).default({}),
    status: z.enum(fileStatuses).nullable().default(null),
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
    { key: { parentId: 1, type: 1, name: 1, _id: 1 }, name: "nodes_listing" },
    { key: { ancestors: 1 }, name: "nodes_ancestors" },
    { key: { ownerId: 1, parentId: 1 }, name: "nodes_owner_parent" },
    // The listing's sorts (`nodes.list.ts`): folders first, then the field,
    // then the name and the id, so a cursor is stable.
    {
      key: { parentId: 1, type: -1, updatedAt: 1, _id: 1 },
      name: "nodes_listing_date",
    },
    {
      key: { parentId: 1, type: -1, size: 1, name: 1, _id: 1 },
      name: "nodes_listing_size",
    },
    {
      key: { parentId: 1, type: -1, family: 1, name: 1, _id: 1 },
      name: "nodes_listing_kind",
    },
    { key: { tags: 1 }, name: "nodes_tags" },
    {
      key: { blobKey: 1 },
      name: "nodes_blob_key",
      partialFilterExpression: { blobKey: { $type: "string" } },
    },
  ],
});
