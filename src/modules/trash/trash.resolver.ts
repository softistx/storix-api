import { requireWorkspacePermission } from "@/core/access";
import { callerSeat } from "@/core/members";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { filesMongo } from "@/modules/files/public";
import { nodesMongo, nodeView } from "@/modules/nodes/public";
import {
  emptyTrash,
  listTrash,
  purgeNodes,
  restoreNodes,
  trashNodes,
} from "./services";
import { doneBy, recordEmpty, recordTrash } from "./utils";

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
          hasPreviousPage: typeof after === "string",
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
        workspacesMongo(ctx.tenancy.core),
        {
          workspaceId: scope.tenant.id,
          accountId: await callerSeat(scope, principal.accountId),
          ids,
        },
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      for (const node of trashed) await recordTrash(done, "node.trash", node);
      await ctx.notify.usage({ scope });
      return trashed.map(nodeView);
    },
    restoreNodes: async (_, { ids }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const restored = await restoreNodes(
        filesMongo(scope.mongo),
        workspacesMongo(ctx.tenancy.core),
        { workspaceId: scope.tenant.id, accountId: principal.accountId, ids },
      );
      const done = doneBy(ctx, scope.tenant.id, principal);
      for (const node of restored) {
        await recordTrash(done, "node.restore", node);
      }
      await ctx.notify.usage({ scope });
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
        workspacesMongo(ctx.tenancy.core),
        {
          workspaceId: scope.tenant.id,
          accountId: principal.accountId,
          ids,
          onPurged: (node) => recordTrash(done, "node.purge", node),
        },
      );
      await ctx.notify.usage({ scope });
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
          workspacesMongo(ctx.tenancy.core),
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
        await ctx.notify.usage({ scope });
      }
      return counts.nodes;
    },
  },
};
