import { defineModule } from "@softistx/alxia-modules";
import type { JoinListener, RemovalListener } from "@/core/members";
import type { TeamDeletedListener } from "@/modules/teams/public";
import { grants } from "./models";
import { dropMemberGrants, dropTeamGrants } from "./services";
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

// The app's wiring (src/config/wiring.ts) hands them to the members kernel. A
// member who leaves loses the grants made to them and the ones they made, in
// the removal itself (`onRemoving`: a failure fails the call). A rejoin reuses
// the member row, so the grants that still name it (a share that raced the
// removal) end when the member joins again.
export const sharesOnRemoved: RemovalListener = (scope, removal) =>
  dropMemberGrants(scope.mongo, removal);

// Told after a team was deleted: the grants made to it end with it.
export const sharesOnTeamDeleted: TeamDeletedListener = (database, team) =>
  dropTeamGrants(database, team.id);

export const sharesOnJoined: JoinListener = (database, joined) =>
  dropMemberGrants(database, joined);
