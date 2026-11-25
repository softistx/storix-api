import { defineModule } from "@softistx/alxia-modules";
import type { RemovalListener } from "@/core/members";
import { grants } from "./models";
import { dropMemberGrants } from "./services";
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

// The app's wiring (src/config/wiring.ts) hands it to the members kernel: a
// member who leaves loses the grants made to them and the ones they made.
export const sharesOnRemoved: RemovalListener = (scope, removal) =>
  dropMemberGrants(scope.mongo, removal);
