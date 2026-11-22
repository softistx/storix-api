import { defineModule } from "@softistx/alxia-modules";
import { invitationTypeDefs } from "../identity";
import { invitations as codes } from "./invitations.errors";
import { invitationsResolvers } from "./invitations.resolver";

// Invitations to a workspace: an admin invites an address with a role, the
// invitee accepts with the code of the mail (7 days, one use) and becomes a
// member, with an account made on the way when the address has none. The
// fields and the store are janus's (`auth.invitations`, janus-graphql); this
// module says who may invite, what a workspace is called, and adds the
// accepted account to the workspace (`joinWorkspace`, wired in
// src/config/auth.ts).
export const invitationsModule = defineModule({
  name: "invitations",
  dependsOn: ["identity", "members", "workspaces", "audit"],
  codes,
  typeDefs: [invitationTypeDefs],
  resolvers: invitationsResolvers,
});
