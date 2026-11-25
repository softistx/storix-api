import { defineModule } from "@softistx/alxia-modules";
import { grants } from "./models";
import { shares as codes } from "./shares.errors";
import typeDefs from "./shares.graphqls" with { type: "text" };
import { sharesResolvers } from "./shares.resolver";

// What folders and files are shared with (plan §3.6): the grants, and the
// effective role every node, version, trash and media guard asks (`roleOn`).
// It owns no permission: sharing is a write of the caller's own tree or of a
// tree they edit, so `nodes:manage` guards it, and the role decides.
export const sharesModule = defineModule({
  name: "shares",
  dependsOn: ["members", "teams", "workspaces", "audit"],
  collections: { grants },
  codes,
  typeDefs: [typeDefs],
  resolvers: sharesResolvers,
});
