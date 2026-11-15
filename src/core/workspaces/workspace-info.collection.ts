import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

// A placeholder: `@softistx/mongo` opens a tenant database only when it is
// wired with at least one collection, and no module owns a workspace
// collection before the files module (A5). Nothing reads or writes it; remove
// it when A5 brings the first real one.
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
