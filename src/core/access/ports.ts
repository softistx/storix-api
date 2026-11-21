import type { Viewer } from "@softistx/alxia-access";
import type { TenantScope } from "@softistx/alxia-tenancy";
import type { WorkspaceRole } from "../members";
import type { Workspace } from "../workspaces";

// What the request context says of the tenancy and of a request's scope, in
// plain types. The context cannot name `typeof tenancy` (src/config/tenancy.ts):
// that type is built from the registered modules, whose resolvers are typed by
// the context, so the types would chase each other and every `ctx` would
// collapse to `unknown`. A resolver that needs a module's typed handle casts
// `core` / `mongo` to it (`ModuleCoreHandle`, `ModuleHandle`).

// A request's scope: the workspace, the caller's role, its database (the
// caller as actor) and the core database.
export type WorkspaceScope = TenantScope<
  unknown,
  unknown,
  Workspace,
  WorkspaceRole
>;

export interface TenancyPort {
  // The core database: workspaces, members, translations.
  readonly core: unknown;
  // Builds a workspace's database (collections, indexes, migrations).
  prepare(id: string): Promise<unknown>;
  // Opens a prepared workspace to requests.
  activate(id: string, actor: string): Promise<unknown>;
  // The scope of a request, or a `TenancyError`.
  scope(request: Request, viewer: Viewer | null): Promise<WorkspaceScope>;
}
