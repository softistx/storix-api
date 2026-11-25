import { toObjectId } from "@softistx/mongo";
import type { MembersMongo } from "@/core/members";
import { findTeam, teamsMongo } from "@/modules/teams/public";

// Who a grant, or a quota alert, reaches: account ids, de-duplicated, the
// actor left out (nobody is told of what they did themselves).

export async function recipientsOfGrant(
  deps: { members: MembersMongo; database: unknown; workspaceId: string },
  input: {
    principal: { type: "MEMBER" | "TEAM"; id: string };
    actorId: string;
    node?: { ownerId?: string | null };
  },
): Promise<string[]> {
  // The members of a team, or none for a team that no longer exists.
  const teamMemberIds = async () =>
    (await findTeam(teamsMongo(deps.database), input.principal.id))
      ?.memberIds ?? [];
  const memberIds =
    input.principal.type === "TEAM"
      ? await teamMemberIds()
      : [toObjectId(input.principal.id)];
  if (memberIds.length === 0) return [];
  // The accounts of the current members among these member-row ids.
  const rows = await deps.members.db.members.findMany({
    filter: {
      workspaceId: toObjectId(deps.workspaceId),
      _id: { $in: [...memberIds] },
      removedAt: null,
    },
  });
  const accounts = rows.map((row) => row.accountId);
  // The actor, and the node's owner for a team grant (the owner sits in the
  // team without being a grantee), are left out.
  const owner = input.principal.type === "TEAM" ? input.node?.ownerId : null;
  return [...new Set(accounts)].filter(
    (id) => id !== input.actorId && id !== owner,
  );
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
