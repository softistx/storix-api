import { toObjectId, tryObjectId } from "@softistx/mongo";
import { NAME_COLLATION, type TeamDoc, type TeamsMongo } from "../models";
import { named, teamNotFound } from "../teams.errors";

// The team with this id in this workspace's database, or undefined: a
// malformed id and an id of another workspace's team are the same answer, and
// the database is the request's own, so no other workspace's team is reached.
export async function findTeam(
  mongo: Pick<TeamsMongo, "db">,
  id: string,
): Promise<TeamDoc | undefined> {
  const objectId = tryObjectId(id);
  if (!objectId) return undefined;
  return (await mongo.db.teams.findById(objectId)) ?? undefined;
}

// The same team, or 404.
export async function getTeam(
  mongo: Pick<TeamsMongo, "db">,
  id: string,
): Promise<TeamDoc> {
  const team = await findTeam(mongo, id);
  if (!team) throw teamNotFound();
  return team;
}

export const listTeams = (mongo: TeamsMongo) =>
  mongo.db.teams.findMany({ sort: { name: 1 }, collation: NAME_COLLATION });

export const createTeam = (mongo: TeamsMongo, name: string, actorId: string) =>
  named(() => mongo.db.teams.as(actorId).create({ name, memberIds: [] }));

// Answers the team as renamed and as it was.
export async function renameTeam(
  mongo: TeamsMongo,
  input: { id: string; name: string; actorId: string },
) {
  const before = await getTeam(mongo, input.id);
  const team = await named(() =>
    mongo.db.teams.as(input.actorId).update(before._id, { name: input.name }),
  );
  return { team, before };
}

// Replaces a team's members. `memberIds` are checked by the caller against the
// workspace's members (`member-unknown`); repeats are dropped here. Answers
// the team as changed and as it was.
export async function setTeamMembers(
  mongo: TeamsMongo,
  input: { id: string; memberIds: readonly string[]; actorId: string },
) {
  const before = await getTeam(mongo, input.id);
  const unique = [...new Set(input.memberIds)];
  const team = await mongo.db.teams
    .as(input.actorId)
    .update(before._id, { memberIds: unique.map((id) => toObjectId(id)) });
  return { team, before };
}

// Changes the name and/or the members of a team in ONE transaction: the team
// is read and written inside it, so a refusal (`name-taken`, `not-found`)
// changes nothing. `memberIds` are checked by the caller against the
// workspace's members (`member-unknown`); repeats are dropped here. Answers
// the team as changed and as it was.
export async function updateTeam(
  mongo: TeamsMongo,
  input: {
    id: string;
    name?: string | undefined;
    memberIds?: readonly string[] | undefined;
    actorId: string;
  },
) {
  return named(() =>
    mongo.transaction(async (tx) => {
      const before = await getTeam(tx, input.id);
      const changes: {
        name?: string;
        memberIds?: ReturnType<typeof toObjectId>[];
      } = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.memberIds !== undefined) {
        changes.memberIds = [...new Set(input.memberIds)].map((id) =>
          toObjectId(id),
        );
      }
      const team = await tx.db.teams
        .as(input.actorId)
        .update(before._id, changes);
      return { team, before };
    }),
  );
}

// Answers the team that was deleted.
export async function deleteTeam(
  mongo: TeamsMongo,
  id: string,
  actorId: string,
): Promise<TeamDoc> {
  const team = await getTeam(mongo, id);
  await mongo.db.teams.as(actorId).delete(team._id);
  return team;
}

// A member who left no longer belongs to any team of the workspace.
export const removeMemberFromTeams = (mongo: TeamsMongo, memberId: string) =>
  mongo.db.teams.updateMany(
    { memberIds: toObjectId(memberId) },
    { $pull: { memberIds: toObjectId(memberId) } },
  );

// The ids of the teams a member belongs to (the access check's input: a grant
// on a team reaches each of its members).
export async function teamIdsOfMember(
  mongo: Pick<TeamsMongo, "db">,
  memberId: string,
): Promise<TeamDoc["_id"][]> {
  const teams = await mongo.db.teams.findMany({
    filter: { memberIds: toObjectId(memberId) },
  });
  return teams.map((team) => team._id);
}
