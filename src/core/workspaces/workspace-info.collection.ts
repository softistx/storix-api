import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// What a workspace's own database says of itself: which workspace it belongs
// to. One row, written when the database is built. It is also what lets
// `@softistx/mongo` open a tenant database at all, which needs one collection:
// the files, folders and the rest come with their modules (A5 on), and this one
// stays as the database's identity.
export const workspaceInfo = defineCollection({
  name: "workspaceInfo",
  schema: z.object({
    _id: id(),
    workspaceId: objectId(),
  }),
  timestamps: true,
  indexes: [
    { key: { workspaceId: 1 }, unique: true, name: "workspace_info_workspace" },
  ],
});
