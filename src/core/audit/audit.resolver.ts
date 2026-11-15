import { requireWorkspacePermission } from "@/core/access";
import type { Resolvers } from "@/generated/graphql/resolvers";
import type { AuditMongo } from "./audit.record";
import { type AuditDoc, listEvents } from "./audit.service";

const view = (event: AuditDoc) => ({
  id: event.id,
  at: event.at,
  actor: event.actor,
  action: event.action,
  target: event.target,
  ipHash: event.ipHash,
  meta: event.meta,
});

export const auditResolvers: Resolvers = {
  Query: {
    auditEvents: async (_, { filter, first, after }, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "audit:read");
      const page = await listEvents(
        (scope as { readonly mongo: unknown }).mongo as AuditMongo,
        {
          filter,
          first,
          after: after ?? null,
        },
      );
      return {
        nodes: page.items.map(view),
        pageInfo: {
          startCursor: after ?? null,
          endCursor: page.endCursor,
          hasNextPage: page.endCursor !== null,
          hasPreviousPage: after != null,
        },
      };
    },
  },
};
