import { requireWorkspacePermission } from "@/core/access";
import {
  callerSeat,
  grantsOnNode,
  grantView,
  roleOn,
} from "@/modules/shares/public";
import { roleNodeOf } from "./utils";

// `Node.myRole` and `Node.grants`, shared by `Folder` and `File`: the caller's
// effective role on the node, and the shares on the node itself, which only an
// owner or an editor sees.
export const nodeRoleFields = {
  myRole: async (
    node: { id: string; ancestors: readonly string[]; ownerId: string | null },
    _: unknown,
    ctx: Parameters<typeof requireWorkspacePermission>[0],
  ) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const seat = await callerSeat(scope, principal.accountId);
    return (await roleOn(scope.mongo, seat, roleNodeOf(node))) ?? "VIEWER";
  },
  grants: async (
    node: { id: string; ancestors: readonly string[]; ownerId: string | null },
    _: unknown,
    ctx: Parameters<typeof requireWorkspacePermission>[0],
  ) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const seat = await callerSeat(scope, principal.accountId);
    const role = await roleOn(scope.mongo, seat, roleNodeOf(node));
    if (role !== "OWNER" && role !== "EDITOR") return [];
    return (await grantsOnNode(scope.mongo, node.id)).map(grantView);
  },
};
