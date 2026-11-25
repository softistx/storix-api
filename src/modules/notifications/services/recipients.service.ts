import { toObjectId } from "@softistx/mongo";
import { GraphQLError } from "graphql";
import type { MembersMongo } from "@/core/members";
import { getTeam, teamsMongo } from "@/modules/teams/public";

// Who a grant, or a quota alert, reaches: account ids, de-duplicated, the
// actor left out (nobody is told of what they did themselves).

// The accounts of the current members among these member-row ids.
async function accountsOfMembers(
  members: MembersMongo,
  workspaceId: string,
  memberIds: readonly ReturnType<typeof toObjectId>[],
): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await members.db.members.findMany({
    filter: {
      workspaceId: toObjectId(workspaceId),
      _id: { $in: [...memberIds] },
      removedAt: null,
    },
  });
  return rows.map((row) => row.accountId);
}

// The members of a team, or none for a team that no longer exists.
async function teamMemberIds(database: unknown, id: string) {
  try {
    return (await getTeam(teamsMongo(database), id)).memberIds;
  } catch (error) {
    if (
      error instanceof GraphQLError &&
      error.extensions["code"] === "teams.errors.not-found"
    ) {
      return [];
    }
    throw error;
  }
}

export async function recipientsOfGrant(
  deps: { members: MembersMongo; database: unknown; workspaceId: string },
  input: {
    principal: { type: "MEMBER" | "TEAM"; id: string };
    actorId: string;
  },
): Promise<string[]> {
  const memberIds =
    input.principal.type === "TEAM"
      ? await teamMemberIds(deps.database, input.principal.id)
      : [toObjectId(input.principal.id)];
  const accounts = await accountsOfMembers(
    deps.members,
    deps.workspaceId,
    memberIds,
  );
  return [...new Set(accounts)].filter((id) => id !== input.actorId);
}

// The owners and admins of a workspace: who a storage alert is for.
export async function administratorsOf(
  members: MembersMongo,
  workspaceId: string,
): Promise<string[]> {
  const rows = await members.db.members.findMany({
    filter: {
      workspaceId: toObjectId(workspaceId),
      role: { $in: ["OWNER", "ADMIN"] },
      removedAt: null,
    },
  });
  return [...new Set(rows.map((row) => row.accountId))];
}
