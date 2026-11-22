import { defineModule } from "@softistx/alxia-modules";
import type { RemovalListener } from "@/core/members";
import { teams as codes } from "@/i18n/codes";
import { teams, teamsMongo } from "./models";
import { removeMemberFromTeams } from "./services";
import typeDefs from "./teams.graphqls" with { type: "text" };
import { teamsResolvers } from "./teams.resolver";

// Teams of members, in the workspace's own database. Owns `teams:read` (every
// role: any member shares with a team, so any member lists them) and
// `teams:manage` (OWNER, ADMIN: plan §3.6). A member who leaves a workspace
// leaves its teams (`teamsOnRemoved`).
export const teamsModule = defineModule({
  name: "teams",
  dependsOn: ["members", "workspaces", "audit"],
  collections: { teams },
  codes,
  permissions: ["teams:read", "teams:manage"],
  defaultGrants: {
    ADMIN: ["teams:read", "teams:manage"],
    MEMBER: ["teams:read"],
  },
  typeDefs: [typeDefs],
  resolvers: teamsResolvers,
});

// The app's wiring (src/config/wiring.ts) hands it to the members kernel.
export const teamsOnRemoved: RemovalListener = (scope, removal) =>
  removeMemberFromTeams(teamsMongo(scope.mongo), removal.memberId);
