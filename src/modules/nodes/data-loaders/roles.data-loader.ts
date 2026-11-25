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
import { roleNodeOf } from "../utils";

type GrantList = Awaited<ReturnType<typeof grantsOnNodes>>[number];
type NodeView = Parameters<typeof roleNodeOf>[0];

interface RoleLoaders {
  roles: DataLoader<RoleNodeInput, Role | null, string>;
  grants: DataLoader<string, GrantList>;
}

// One pair of loaders per request: the caller's seat and teams are resolved
// once, and every node of a page asks its role (or its grants) in the same
// tick, so the grants of the page and of all its ancestors are read with ONE
// `$in` instead of one read per node and per field.
const loaders = new WeakMap<object, Promise<RoleLoaders>>();

async function build(ctx: Context): Promise<RoleLoaders> {
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
}

function loadersOf(ctx: Context): Promise<RoleLoaders> {
  let found = loaders.get(ctx);
  if (!found) {
    found = build(ctx);
    loaders.set(ctx, found);
  }
  return found;
}

// The caller's role on a node of a page (null: no access).
export async function roleOfNode(
  view: NodeView,
  ctx: Context,
): Promise<Role | null> {
  return (await loadersOf(ctx)).roles.load(roleNodeOf(view));
}

// The grants on a node, batched by node id.
export async function grantsOfNode(
  nodeId: string,
  ctx: Context,
): Promise<GrantList> {
  return (await loadersOf(ctx)).grants.load(nodeId);
}
