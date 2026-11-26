import { requireWorkspacePermission } from "@/core/access";
import { callerSeat } from "@/core/members";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { fail } from "@/i18n/fail";
import { fileOf, filesMongo, largestFiles } from "@/modules/files/public";
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
  Storage: {
    largestFiles: async (_, { first }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "workspace:read",
      );
      const who = await callerSeat(scope, principal.accountId);
      const files = await largestFiles(filesMongo(scope.mongo), {
        who,
        first,
      });
      return files.map(fileOf);
    },
  },
};
