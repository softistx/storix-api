import {
  type Permission,
  requireMember,
  requirePermission,
} from "@softistx/alxia-access";
import type { Principal } from "@/core/identity";
import type { Context } from "@/http/context";
import { apiKeyNotAccepted, unauthenticated } from "@/i18n/fail";
import type { WorkspaceScope } from "./ports";
import { apiRefusal } from "./refusals";

// What a workspace operation gets after its guard: the caller (a session, never
// a key) and the workspace's scope (its database, the caller's role).
export interface Guarded {
  principal: Principal;
  scope: WorkspaceScope;
}

// The person behind a workspace operation. A personal API key is refused until
// the `api-keys` slice binds keys to workspaces (a key is never its owner
// acting as a member, plan §3.7): 401 `auth.errors.api-key-not-accepted`.
function sessionOf(ctx: Context): Principal {
  if (!ctx.viewer) throw unauthenticated();
  if (ctx.viewer.apiKeyId !== null) {
    throw apiKeyNotAccepted();
  }
  return ctx.viewer;
}

async function guarded(ctx: Context, check: () => Promise<WorkspaceScope>) {
  const principal = sessionOf(ctx);
  try {
    return { principal, scope: await check() } satisfies Guarded;
  } catch (error) {
    throw apiRefusal(error);
  }
}

// Guard first in every resolver of a workspace: the request's workspace (the
// tenant header), the caller's membership and the permission their role holds.
// Order of refusals: 401 (no session), 400 (no header), 404 (unknown
// workspace or not a member), 403 (the role lacks the permission).
export const requireWorkspacePermission = (
  ctx: Context,
  permission: Permission,
): Promise<Guarded> =>
  guarded(ctx, () => requirePermission(ctx.guard, permission));

// Any member of the request's workspace, whatever the role.
export const requireWorkspaceMember = (ctx: Context): Promise<Guarded> =>
  guarded(ctx, () => requireMember(ctx.guard));

// The session of an operation that needs no workspace in the request
// (createWorkspace, myWorkspaces).
export const requireAccountSession = sessionOf;
