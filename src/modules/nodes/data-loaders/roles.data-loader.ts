import DataLoader from "dataloader";
import { requireWorkspacePermission } from "@/core/access";
import { callerSeat } from "@/core/members";
import type { Context } from "@/http/context";
import {
  grantsOnNodes,
  type Role,
  type RoleNodeInput,
  rolesOn,
} from "@/modules/shares/public";

type GrantList = Awaited<ReturnType<typeof grantsOnNodes>>[number];

export interface RoleLoaders {
  roles: DataLoader<RoleNodeInput, Role | null, string>;
  grants: DataLoader<string, GrantList>;
}

// One pair of loaders per request: the caller's seat and teams are resolved
// once, and every node of a page asks its role (or its grants) in the same
// tick, so the grants of the page and of all its ancestors are read with ONE
// `$in` instead of one read per node and per field.
const loaders = new WeakMap<object, Promise<RoleLoaders>>();

// The loaders of this request, built on first use (the caller's seat and teams
// are resolved once).
export function rolesLoadersOf(ctx: Context): Promise<RoleLoaders> {
  const found = loaders.get(ctx);
  if (found) return found;
  const built = (async (): Promise<RoleLoaders> => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const seat = await callerSeat(scope, principal.accountId);
    return {
      roles: new DataLoader<RoleNodeInput, Role | null, string>(
        (nodes) => rolesOn(scope.mongo, seat, nodes),
        { cacheKeyFn: (node) => node._id.toHexString() },
      ),
      grants: new DataLoader<string, GrantList>((ids) =>
        grantsOnNodes(scope.mongo, ids),
      ),
    };
  })();
  loaders.set(ctx, built);
  return built;
}
