import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

export const grantRoles = ["VIEWER", "EDITOR"] as const;
export const principalTypes = ["MEMBER", "TEAM"] as const;

// What a node is shared with, in the workspace's own database (plan §3.6): one
// row per node and principal. `principal.id` is the id of a core `members` row
// (what `Member.id` says) or of a team, never an account id; `grantedBy` is
// the account that shared. A grant on a folder reaches its whole subtree, and
// a node's effective role is the highest of its own grants and its
// ancestors'.
export const grants = defineCollection({
  name: "grants",
  schema: z.object({
    _id: id(),
    nodeId: objectId(),
    principal: z.object({
      type: z.enum(principalTypes),
      id: objectId(),
    }),
    role: z.enum(grantRoles),
    grantedBy: z.string().min(1),
  }),
  timestamps: true,
  actors: { type: z.string() },
  indexes: [
    {
      key: { nodeId: 1, "principal.type": 1, "principal.id": 1 },
      unique: true,
      name: "grants_node_principal_unique",
    },
    {
      key: { "principal.type": 1, "principal.id": 1 },
      name: "grants_principal",
    },
  ],
});
