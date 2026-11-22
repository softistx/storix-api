import { requireWorkspacePermission } from "@/core/access";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { fail } from "@/i18n/fail";
import { storageView } from "./services";

export const quotasResolvers: Resolvers = {
  Query: {
    storage: async (_, __, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "workspace:read");
      const view = await storageView(
        workspacesMongo(ctx.tenancy.core),
        scope.tenant.id,
      );
      if (!view) throw fail("workspaces.errors.not-found", { status: 404 });
      return view;
    },
  },
};
