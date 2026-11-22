import { toObjectId, tryObjectId } from "@softistx/mongo";
import type { MembersMongo } from "./members.service";

// A page of a workspace's current members, oldest first.
export async function listMembers(
  mongo: MembersMongo,
  input: { workspaceId: string; first: number; after: string | null },
) {
  const workspaceId = toObjectId(input.workspaceId);
  const filter = { workspaceId, removedAt: null };
  const [page, totalCount] = await Promise.all([
    mongo.db.members.paginateByCursor({
      filter,
      limit: input.first,
      after: input.after,
      orderBy: "createdAt",
      direction: "asc",
      scope: `members:${input.workspaceId}`,
    }),
    mongo.db.members.count(filter),
  ]);
  return { items: page.items, endCursor: page.nextCursor, totalCount };
}

// The memberships of an account, in active workspaces or not (the caller
// filters by the workspaces it loads).
export const membershipsOfAccount = (mongo: MembersMongo, accountId: string) =>
  mongo.db.members.findMany({ filter: { accountId, removedAt: null } });

// The ids among `ids` that are current members of the workspace, as strings.
// An id that is malformed, unknown, of another workspace or of a member who
// left is simply not in the answer.
export async function activeMemberIds(
  mongo: MembersMongo,
  workspaceId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const objectIds = ids.flatMap((id) => tryObjectId(id) ?? []);
  if (objectIds.length === 0) return new Set();
  const found = await mongo.db.members.findMany({
    filter: {
      workspaceId: toObjectId(workspaceId),
      _id: { $in: objectIds },
      removedAt: null,
    },
  });
  return new Set(found.map((member) => member.id));
}
