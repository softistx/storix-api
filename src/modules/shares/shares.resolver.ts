import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import { membersMongo } from "@/core/members";
import type { Resolvers } from "@/generated/graphql/resolvers";
import {
  assertPrincipal,
  grantNode,
  nodeToShare,
  regrant,
  revoke,
} from "./services";
import {
  callerSeat,
  grantView,
  recordRegrant,
  recordShare,
  recordUnshare,
} from "./utils";

export const sharesResolvers: Resolvers = {
  Mutation: {
    shareNode: async (_, { id, principal, role }, ctx) => {
      const { principal: who, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const seat = await callerSeat(scope, who.accountId);
      const node = await nodeToShare(scope.mongo, seat, id);
      await assertPrincipal(
        {
          database: scope.mongo,
          core: membersMongo(scope.core),
          workspaceId: scope.tenant.id,
        },
        principal,
      );
      const grant = await grantNode(scope.mongo, {
        nodeId: node._id.toHexString(),
        principal,
        role,
        accountId: who.accountId,
      });
      await recordShare(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(who),
          ip: ctx.ip,
          auditor: ctx.audit,
        },
        node,
        grant,
      );
      return grantView(grant);
    },
    changeGrant: async (_, { id, grantId, role }, ctx) => {
      const { principal: who, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const seat = await callerSeat(scope, who.accountId);
      const node = await nodeToShare(scope.mongo, seat, id);
      const { grant, before } = await regrant(scope.mongo, {
        nodeId: node._id.toHexString(),
        id: grantId,
        role,
        accountId: who.accountId,
      });
      await recordRegrant(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(who),
          ip: ctx.ip,
          auditor: ctx.audit,
        },
        node,
        grant,
        before,
      );
      return grantView(grant);
    },
    unshareNode: async (_, { id, grantId }, ctx) => {
      const { principal: who, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const seat = await callerSeat(scope, who.accountId);
      const node = await nodeToShare(scope.mongo, seat, id);
      const before = await revoke(scope.mongo, {
        nodeId: node._id.toHexString(),
        id: grantId,
      });
      await recordUnshare(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(who),
          ip: ctx.ip,
          auditor: ctx.audit,
        },
        node,
        before,
      );
      return grantView(before);
    },
  },
};
