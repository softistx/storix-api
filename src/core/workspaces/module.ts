import { defineModule } from "@softistx/alxia-modules";
import { workspaces as codes } from "@/i18n/codes";
import { workspacesQuota } from "./migrations/2026-11-20-workspaces-quota.migration";
import { workspacesSettings } from "./migrations/2026-11-21-workspaces-settings.migration";
import { workspaces } from "./models/workspaces.model";
import typeDefs from "./workspaces.graphqls" with { type: "text" };
import { workspacesResolvers } from "./workspaces.resolver";

// The tenant: a workspace, with its own database. Anyone signed in creates one
// and becomes its OWNER; every other module's data lives in the workspace's
// database, reached through the request's scope (src/config/tenancy.ts).
export const workspacesModule = defineModule({
  name: "workspaces",
  dependsOn: ["members", "audit"],
  coreCollections: { workspaces },
  coreMigrations: [workspacesQuota, workspacesSettings],
  codes,
  permissions: ["workspace:read", "workspace:manage"],
  defaultGrants: {
    ADMIN: ["workspace:read", "workspace:manage"],
    MEMBER: ["workspace:read"],
  },
  typeDefs: [typeDefs],
  resolvers: workspacesResolvers,
});
