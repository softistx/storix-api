import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { requireAccountSession, requireWorkspacePermission } from "../access";
import { membershipsOfAccount, type WorkspaceRole } from "../members";
import { isObjectIdLike } from "./workspaces.collection";
import { type Workspace, workspaceOf } from "./workspaces.registry";
import { createWorkspace, type WorkspacesMongo } from "./workspaces.service";

const view = (workspace: Workspace, myRole: WorkspaceRole) => ({
  id: workspace.id,
  slug: workspace.slug,
  name: workspace.name,
  myRole,
  createdAt: workspace.createdAt,
});

export const workspacesResolvers: Resolvers = {
  Query: {
    workspace: async (_, __, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "workspace:read");
      return view(scope.tenant, scope.member);
    },
    myWorkspaces: async (_, __, ctx) => {
      const { accountId } = requireAccountSession(ctx);
      const mongo = ctx.tenancy.core as WorkspacesMongo;
      const memberships = await membershipsOfAccount(mongo, accountId);
      const roles = new Map(
        memberships.map((m) => [m.workspaceId.toHexString(), m.role]),
      );
      const found = await mongo.db.workspaces.findMany({
        filter: {
          _id: { $in: memberships.map((m) => m.workspaceId) },
          status: "active",
        },
        sort: { name: 1 },
      });
      return found.map((doc) =>
        view(workspaceOf(doc), roles.get(doc.id) ?? "MEMBER"),
      );
    },
  },
  Mutation: {
    createWorkspace: async (_, { input }, ctx) => {
      const { accountId } = requireAccountSession(ctx);
      await ctx.limits.workspaceCreate(ctx.ip);
      const name = input.name.trim();
      if (name === "") {
        throw invalidInput([
          {
            path: "name",
            code: "validation.errors.too-short",
            params: { min: 1 },
          },
        ]);
      }
      if (isObjectIdLike(input.slug)) {
        throw invalidInput([
          { path: "slug", code: "validation.errors.invalid-format" },
        ]);
      }
      const workspace = await createWorkspace(
        ctx.tenancy.core as WorkspacesMongo,
        ctx.tenancy,
        {
          slug: input.slug,
          name,
          accountId,
        },
      );
      return view(workspace, "OWNER");
    },
  },
};
