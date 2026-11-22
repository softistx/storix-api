import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { requireAccountSession, requireWorkspacePermission } from "../access";
import { memberActor } from "../audit";
import { settingsOfWorkspace } from "./data-loaders";
import { isObjectIdLike, workspacesMongo } from "./models";
import {
  createWorkspace,
  renameWorkspace,
  updateSettings,
  workspacesOfAccount,
} from "./services";
import { view } from "./utils";
import { notFound } from "./workspaces.errors";

export const workspacesResolvers: Resolvers = {
  Workspace: {
    settings: (workspace, _, ctx) => settingsOfWorkspace(workspace, ctx),
  },
  Query: {
    workspace: async (_, __, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "workspace:read");
      return view(scope.tenant, scope.member);
    },
    myWorkspaces: async (_, __, ctx) => {
      const { accountId } = requireAccountSession(ctx);
      const mine = await workspacesOfAccount(
        workspacesMongo(ctx.tenancy.core),
        accountId,
      );
      return mine.map(({ workspace, role }) => view(workspace, role));
    },
  },
  Mutation: {
    createWorkspace: async (_, { input }, ctx) => {
      const principal = requireAccountSession(ctx);
      const { accountId } = principal;
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
        workspacesMongo(ctx.tenancy.core),
        ctx.tenancy,
        {
          slug: input.slug,
          name,
          accountId,
        },
        ctx.members,
      );
      await ctx.audit.record({
        workspaceId: workspace.id,
        actor: memberActor(principal),
        action: "workspace.create",
        target: { type: "WORKSPACE", id: workspace.id, name: workspace.name },
        ip: ctx.ip,
        meta: { slug: workspace.slug },
      });
      return view(workspace, "OWNER");
    },
    renameWorkspace: async (_, { name: raw }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "workspace:manage",
      );
      const name = raw.trim();
      if (name === "") {
        throw invalidInput([
          {
            path: "name",
            code: "validation.errors.too-short",
            params: { min: 1 },
          },
        ]);
      }
      const core = workspacesMongo(ctx.tenancy.core);
      if (!(await renameWorkspace(core, scope.tenant.id, name))) {
        throw notFound();
      }
      await ctx.audit.record({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        action: "workspace.rename",
        target: { type: "WORKSPACE", id: scope.tenant.id, name },
        ip: ctx.ip,
        meta: { from: scope.tenant.name, to: name },
      });
      return view({ ...scope.tenant, name }, scope.member);
    },
    updateWorkspaceSettings: async (_, { input }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "workspace:manage",
      );
      const core = workspacesMongo(ctx.tenancy.core);
      const patch = {
        ...(input.trashDays != null && { trashDays: input.trashDays }),
        ...(input.versionsMax != null && { versionsMax: input.versionsMax }),
        ...(input.versionsDays != null && { versionsDays: input.versionsDays }),
      };
      const settings = await updateSettings(core, scope.tenant.id, patch);
      if (!settings) throw notFound();
      await ctx.audit.record({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        action: "workspace.settings",
        target: {
          type: "WORKSPACE",
          id: scope.tenant.id,
          name: scope.tenant.name,
        },
        ip: ctx.ip,
        meta: patch,
      });
      return settings;
    },
  },
};
