import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { filesMongo } from "@/modules/files/public";
import { nodesMongo, nodeView } from "@/modules/nodes/public";
import { recordEmpty, recordTrash } from "./trash.audit";
import { listTrash } from "./trash.list";
import { emptyTrash, purgeNodes } from "./trash.purge";
import { restoreNodes, trashNodes } from "./trash.service";

const doneBy = (
  ctx: { ip?: string | null | undefined },
  workspaceId: string,
  principal: { accountId: string; name: string },
) => ({ workspaceId, actor: memberActor(principal), ip: ctx.ip });

export const trashResolvers: Resolvers = {
  Query: {
    trash: async (_, { first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listTrash(nodesMongo(scope.mongo), {
        accountId: principal.accountId,
        first,
        after,
      });
      return {
        nodes: page.items.map(nodeView),
        pageInfo: {
          startCursor: null,
          endCursor: page.endCursor,
          hasNextPage: page.endCursor !== null,
          hasPreviousPage: after != null,
        },
      };
    },
  },
  Mutation: {
    trashNodes: async (_, { ids }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const trashed = await trashNodes(
        filesMongo(scope.mongo),
        ctx.tenancy.core as WorkspacesMongo,
        { workspaceId: scope.tenant.id, accountId: principal.accountId, ids },
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      for (const node of trashed) await recordTrash(done, "node.trash", node);
      return trashed.map(nodeView);
    },
    restoreNodes: async (_, { ids }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const restored = await restoreNodes(
        filesMongo(scope.mongo),
        ctx.tenancy.core as WorkspacesMongo,
        { workspaceId: scope.tenant.id, accountId: principal.accountId, ids },
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      for (const node of restored) {
        await recordTrash(done, "node.restore", node);
      }
      return restored.map(nodeView);
    },
    purgeNodes: async (_, { ids }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const { entries, removed } = await purgeNodes(
        filesMongo(scope.mongo),
        ctx.tenancy.core as WorkspacesMongo,
        { workspaceId: scope.tenant.id, accountId: principal.accountId, ids },
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      for (const node of entries) await recordTrash(done, "node.purge", node);
      return removed;
    },
    emptyTrash: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const { entries, removed } = await emptyTrash(
        filesMongo(scope.mongo),
        ctx.tenancy.core as WorkspacesMongo,
        { workspaceId: scope.tenant.id, accountId: principal.accountId },
      );
      await recordEmpty(
        doneBy(ctx, scope.tenant.id, principal),
        principal.accountId,
        { entries, nodes: removed },
      );
      return removed;
    },
  },
};
