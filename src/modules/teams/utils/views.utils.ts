import { activeMemberIds } from "@/core/members";
import type { TeamDoc } from "../models";
import { coreDb, type Scope } from "./session.utils";

// A team as the API says it, its members kept to the current ones.
export function teamView(team: TeamDoc, current: ReadonlySet<string>) {
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
}

// Teams as the API says them. The members come from the workspace's current
// members: an id left behind by a member who has since gone (a clean-up that
// failed) is never shown or counted.
export async function views(scope: Scope, teams: readonly TeamDoc[]) {
  const current = await activeMemberIds(
    coreDb(scope),
    scope.tenant.id,
    teams.flatMap((team) => team.memberIds.map((id) => id.toHexString())),
  );
  return teams.map((team) => teamView(team, current));
}

export async function view(scope: Scope, team: TeamDoc) {
  const [one] = await views(scope, [team]);
  return one as NonNullable<typeof one>;
}
