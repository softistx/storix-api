import { requireWorkspacePermission } from "@/core/access";
import { type Auditor, memberActor } from "@/core/audit";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { filesMongo } from "@/modules/files/public";
import { nodesMongo, nodeView } from "@/modules/nodes/public";
import { recordEmpty, recordTrash } from "./trash.audit";
import { listTrash } from "./trash.list";
import { emptyTrash, purgeNodes } from "./trash.purge";
import { restoreNodes, trashNodes } from "./trash.service";

const doneBy = (
  ctx: { ip?: string | null | undefined; audit: Auditor },
  workspaceId: string,
  principal: { accountId: string; name: string },
) => ({
  workspaceId,
  actor: memberActor(principal),
  ip: ctx.ip,
  auditor: ctx.audit,
});

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
      const done = doneBy(ctx, scope.tenant.id, principal);
      // Each entry is audited as it is purged, so a failure partway leaves a
      // record of what went.
      const { removed } = await purgeNodes(
        filesMongo(scope.mongo),
        ctx.tenancy.core as WorkspacesMongo,
        {
          workspaceId: scope.tenant.id,
          accountId: principal.accountId,
          ids,
          onPurged: (node) => recordTrash(done, "node.purge", node),
        },
      );
      return removed;
    },
    emptyTrash: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      const counts = { entries: 0, nodes: 0 };
      try {
        await emptyTrash(
          filesMongo(scope.mongo),
          ctx.tenancy.core as WorkspacesMongo,
          {
            workspaceId: scope.tenant.id,
            accountId: principal.accountId,
            onPurged: (_entry, removed) => {
              counts.entries += 1;
              counts.nodes += removed;
            },
          },
        );
      } finally {
        // Also when it failed partway: what was purged is recorded.
        if (counts.entries > 0) {
          await recordEmpty(done, principal.accountId, counts);
        }
      }
      return counts.nodes;
    },
  },
};
