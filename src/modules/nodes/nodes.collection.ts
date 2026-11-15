import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// How names are compared: case does not tell two names apart (`Photos` and
// `photos` are one), accents still do. The unique index and every lookup by
// name use it.
export const NAME_COLLATION = { locale: "en", strength: 2 } as const;

export const nodeTypes = ["FOLDER", "FILE"] as const;

// The tree of a workspace: folders now, files from the files module, one
// collection (plan §3.3). `parentId` is null for a root; `ancestors` lists the
// ids from the root down to the parent, so "everything under this folder" is
// one index read. `ownerId` is the account that owns the root the node sits
// under (plan §3.6); `spaceId`, for an API key's app space, is null until the
// api-keys slice. `treeRev` is raised by every write that changes the shape of
// the tree under a folder; `version` is the optimistic lock a rename carries.
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
  ],
});
