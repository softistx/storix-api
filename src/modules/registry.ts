import { type Module, resolveModules } from "@softistx/alxia-modules";
import type { Resolvers } from "@softistx/graxia";
import type { Migration } from "@softistx/mongo/migrations";
import { auditModule } from "../core/audit";
import { identityModule } from "../core/identity/module";
import { invitationsModule } from "../core/invitations";
import { membersModule } from "../core/members";
import { storageModule } from "../core/storage";
import { system } from "../core/system/module";
import { translationsModule } from "../core/translations/module";
import { workspacesModule } from "../core/workspaces";
import type { Context } from "../http/context";
import { filesModule } from "./files/public";
import { nodesModule } from "./nodes/public";
import { notificationsModule } from "./notifications/public";
import { quotasModule } from "./quotas/public";
import { sharesModule } from "./shares/public";
import { teamsModule } from "./teams/public";
import { trashModule } from "./trash/public";

// THE list of modules: adding one is one line here. Dependency order is
// computed (`resolveModules`), not written. Each module of the plan's §3.2 is
// added by the slice that builds it.
const registered = [
  system,
  translationsModule,
  auditModule,
  identityModule,
  membersModule,
  workspacesModule,
  invitationsModule,
  teamsModule,
  sharesModule,
  notificationsModule,
  nodesModule,
  filesModule,
  trashModule,
  quotasModule,
  storageModule,
] as const;

export const modules: readonly Module[] = resolveModules(registered);

// The registered manifests with their own types, for the typed handles of the
// databases (`CollectionsOf`, `ModuleHandle`; src/config/db.ts).
declare module "@softistx/alxia-modules" {
  interface Register {
    modules: typeof registered;
    migration: Migration;
    resolvers: Resolvers<Context>;
  }
}
