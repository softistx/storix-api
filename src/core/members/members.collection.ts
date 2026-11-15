import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";
import { workspaceRoles } from "./roles";

// A person's membership of a workspace, in the core database (so that "my
// workspaces" is one query and a header can be checked before the workspace's
// own database is opened). `accountId` is the identity port's opaque id. A
// member who left or was removed keeps their row with `removedAt` set, so a
// later invitation reuses it; every read filters `removedAt: null`.
export const members = defineCollection({
  name: "members",
  schema: z.object({
    _id: id(),
    workspaceId: objectId(),
    accountId: z.string().min(1),
    role: z.enum(workspaceRoles),
    removedAt: z.date().nullable().default(null),
  }),
  timestamps: true,
  optimisticLock: true,
  actors: { type: z.string() },
  indexes: [
    {
      key: { workspaceId: 1, accountId: 1 },
      unique: true,
      name: "members_workspace_account_unique",
    },
    { key: { accountId: 1 }, name: "members_account" },
  ],
});
