import type { CollectionsOf, ModuleHandle } from "@alxia/modules";
import {
  ConflictError,
  type Mongo,
  toObjectId,
  tryObjectId,
} from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import { NAME_COLLATION } from "./teams.collection";

// The module's handle on a workspace's database: its own collection only.
export type TeamsMongo = ModuleHandle<
  "teams",
  Mongo<{ collections: CollectionsOf }>
>;

export type TeamDoc = Awaited<ReturnType<TeamsMongo["db"]["teams"]["getById"]>>;

export const teamNotFound = () =>
  fail("teams.errors.not-found", { status: 404 });
export const nameTaken = () =>
  fail("teams.errors.name-taken", { status: 409, field: "name" });
export const memberUnknown = () =>
  fail("teams.errors.member-unknown", { status: 400, field: "memberIds" });

// The team with this id in this workspace's database, or 404: a malformed id
// and an id of another workspace's team are the same answer, and the database
// is the request's own, so no other workspace's team can be reached.
async function teamOf(mongo: TeamsMongo, id: string): Promise<TeamDoc> {
  const objectId = tryObjectId(id);
  const team = objectId && (await mongo.db.teams.findById(objectId));
  if (!team) throw teamNotFound();
  return team;
}

export const getTeam = teamOf;

export const listTeams = (mongo: TeamsMongo) =>
  mongo.db.teams.findMany({ sort: { name: 1 }, collation: NAME_COLLATION });

// Runs a write that may break the unique name index (`name-taken`).
async function named<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ConflictError) throw nameTaken();
    throw error;
  }
}

export const createTeam = (mongo: TeamsMongo, name: string, actorId: string) =>
  named(() => mongo.db.teams.as(actorId).create({ name, memberIds: [] }));

// Answers the team as renamed and as it was.
export async function renameTeam(
  mongo: TeamsMongo,
  input: { id: string; name: string; actorId: string },
) {
  const before = await teamOf(mongo, input.id);
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
  const before = await teamOf(mongo, input.id);
  const unique = [...new Set(input.memberIds)];
  const team = await mongo.db.teams
    .as(input.actorId)
    .update(before._id, { memberIds: unique.map((id) => toObjectId(id)) });
  return { team, before };
}

// Answers the team that was deleted.
export async function deleteTeam(
  mongo: TeamsMongo,
  id: string,
  actorId: string,
): Promise<TeamDoc> {
  const team = await teamOf(mongo, id);
  await mongo.db.teams.as(actorId).delete(team._id);
  return team;
}

// A member who left no longer belongs to any team of the workspace.
export const removeMemberFromTeams = (mongo: TeamsMongo, memberId: string) =>
  mongo.db.teams.updateMany(
    { memberIds: toObjectId(memberId) },
    { $pull: { memberIds: toObjectId(memberId) } },
  );
