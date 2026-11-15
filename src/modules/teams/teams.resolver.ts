import { requireWorkspacePermission } from "@/core/access";
import { activeMemberIds, type MembersMongo } from "@/core/members";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  memberUnknown,
  renameTeam,
  setTeamMembers,
  type TeamDoc,
  type TeamsMongo,
} from "./teams.service";

// The module's handles on the request's databases (the scope's, typed by the
// registry; see src/core/access/ports.ts).
const workspaceDb = (scope: { readonly mongo: unknown }) =>
  scope.mongo as TeamsMongo;
const coreDb = (scope: { readonly core: unknown }) =>
  scope.core as MembersMongo;

interface Scope {
  readonly core: unknown;
  readonly tenant: { readonly id: string };
}

// Teams as the API says them. The members come from the workspace's current
// members: an id left behind by a member who has since gone (a clean-up that
// failed) is never shown or counted.
async function views(scope: Scope, teams: readonly TeamDoc[]) {
  const current = await activeMemberIds(
    coreDb(scope),
    scope.tenant.id,
    teams.flatMap((team) => team.memberIds.map((id) => id.toHexString())),
  );
  return teams.map((team) => {
    const memberIds = team.memberIds
      .map((id) => id.toHexString())
      .filter((id) => current.has(id));
    return {
      id: team.id,
      name: team.name,
      memberIds,
      memberCount: memberIds.length,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  });
}

async function view(scope: Scope, team: TeamDoc) {
  const [one] = await views(scope, [team]);
  return one as NonNullable<typeof one>;
}

// A name is trimmed; a blank one is refused like a too short one.
function nameOf(raw: string): string {
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
  return name;
}

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
      return view(scope, team);
    },
    renameTeam: async (_, { id, name }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      const team = await renameTeam(workspaceDb(scope), {
        id,
        name: nameOf(name),
        actorId: principal.accountId,
      });
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
      const wanted = [...new Set(memberIds)];
      const known = await activeMemberIds(
        coreDb(scope),
        scope.tenant.id,
        wanted,
      );
      if (wanted.some((memberId) => !known.has(memberId))) {
        throw memberUnknown();
      }
      const team = await setTeamMembers(mongo, {
        id,
        memberIds: wanted,
        actorId: principal.accountId,
      });
      return view(scope, team);
    },
    deleteTeam: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "teams:manage",
      );
      await deleteTeam(workspaceDb(scope), id, principal.accountId);
      return true;
    },
  },
};
