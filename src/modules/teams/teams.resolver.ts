import { requireWorkspacePermission } from "@/core/access";
import type { Resolvers } from "@/generated/graphql/resolvers";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  renameTeam,
  setTeamMembers,
  updateTeam,
} from "./services";
import {
  auditOf,
  knownMembers,
  nameOf,
  recordTeamCreate,
  recordTeamDelete,
  recordTeamMembers,
  recordTeamRename,
  view,
  views,
  workspaceDb,
} from "./utils";

export const teamsResolvers: Resolvers = {
  Query: {
    teams: async (_, __, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "teams:read");
      return views(scope, await listTeams(workspaceDb(scope)));
    },
    team: async (_, { id }, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "teams:read");
      return view(scope, await getTeam(workspaceDb(scope), id));
    },
  },
  Mutation: {
    createTeam: async (_, { name }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      const team = await createTeam(
        workspaceDb(scope),
        nameOf(name),
        principal.accountId,
      );
      await recordTeamCreate(auditOf(ctx, scope, principal), team);
      return view(scope, team);
    },
    renameTeam: async (_, { id, name }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      const { team, before } = await renameTeam(workspaceDb(scope), {
        id,
        name: nameOf(name),
        actorId: principal.accountId,
      });
      await recordTeamRename(auditOf(ctx, scope, principal), team, before);
      return view(scope, team);
    },
    setTeamMembers: async (_, { id, memberIds }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      // The team first (404), then its members (400): an id of a member who
      // left, of another workspace or malformed is unknown.
      const mongo = workspaceDb(scope);
      await getTeam(mongo, id);
      const wanted = await knownMembers(scope, memberIds);
      const { team, before } = await setTeamMembers(mongo, {
        id,
        memberIds: wanted,
        actorId: principal.accountId,
      });
      await recordTeamMembers(auditOf(ctx, scope, principal), team, before);
      return view(scope, team);
    },
    updateTeam: async (_, { id, input }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      const mongo = workspaceDb(scope);
      await getTeam(mongo, id);
      const name =
        typeof input.name === "string" ? nameOf(input.name) : undefined;
      const wanted = input.memberIds
        ? await knownMembers(scope, input.memberIds)
        : undefined;
      const { team, before } = await updateTeam(mongo, {
        id,
        name,
        memberIds: wanted,
        actorId: principal.accountId,
      });
      const done = auditOf(ctx, scope, principal);
      if (name !== undefined && name !== before.name) {
        await recordTeamRename(done, team, before);
      }
      if (wanted) await recordTeamMembers(done, team, before);
      return view(scope, team);
    },
    deleteTeam: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      const team = await deleteTeam(
        workspaceDb(scope),
        id,
        principal.accountId,
      );
      await recordTeamDelete(auditOf(ctx, scope, principal), team);
      return true;
    },
  },
};
