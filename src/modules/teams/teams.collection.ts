import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// How team names are compared: case does not tell two names apart (`Design`
// and `design` are one), accents still do. The unique index and every lookup
// by name use it.
export const NAME_COLLATION = { locale: "en", strength: 2 } as const;

// The teams of a workspace, in the workspace's own database. `memberIds` are
// ids of the core `members` rows (what `Member.id` says), never account ids.
// Actors are account ids.
export const teams = defineCollection({
  name: "teams",
  schema: z.object({
    _id: id(),
    name: z.string().min(1).max(100),
    memberIds: z.array(objectId()).default([]),
  }),
  timestamps: true,
  actors: { type: z.string() },
  indexes: [
    {
      key: { name: 1 },
      unique: true,
      name: "teams_name_unique",
      collation: NAME_COLLATION,
    },
    { key: { memberIds: 1 }, name: "teams_members" },
  ],
});
