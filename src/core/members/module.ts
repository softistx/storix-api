import { defineModule } from "@softistx/alxia-modules";
import { members as codes } from "@/i18n/codes";
import typeDefs from "./members.graphqls" with { type: "text" };
import { membersResolvers } from "./members.resolver";
import { members } from "./models/members.model";

// Who belongs to a workspace and with which role. Owns the permissions of the
// membership (`members:read`, `members:manage`) and `owners:manage`, which
// only the OWNER role holds: making or touching an owner is the owners' alone.
export const membersModule = defineModule({
  name: "members",
  dependsOn: ["identity", "audit"],
  coreCollections: { members },
  codes,
  permissions: ["members:read", "members:manage", "owners:manage"],
  defaultGrants: {
    ADMIN: ["members:read", "members:manage"],
    MEMBER: ["members:read"],
  },
  typeDefs: [typeDefs],
  resolvers: membersResolvers,
});
