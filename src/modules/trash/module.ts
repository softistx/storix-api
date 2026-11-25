import { defineModule } from "@softistx/alxia-modules";
import { trash as codes } from "./trash.errors";
import typeDefs from "./trash.graphqls" with { type: "text" };
import { trashResolvers } from "./trash.resolver";

// The trash (plan §3.9): a trashed node leaves every read with its subtree,
// stays in the trash for the workspace's `trashDays`, and is restored or
// purged (the blobs and the quota are released) by its owner. It owns no
// collection: the flags live on the nodes and the blobs are the files module's.
export const trashModule = defineModule({
  name: "trash",
  dependsOn: ["nodes", "files", "members", "workspaces", "audit", "shares"],
  codes,
  typeDefs: [typeDefs],
  resolvers: trashResolvers,
});
