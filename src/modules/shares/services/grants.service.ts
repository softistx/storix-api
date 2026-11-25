import { toObjectId, tryObjectId } from "@softistx/mongo";
import { activeMemberIds, type MembersMongo } from "@/core/members";
import { getTeam, teamsMongo } from "@/modules/teams/public";
import { type GrantDoc, sharesMongo } from "../models";
import type { GrantRole } from "../rules";
import { principalUnknown, shared, shareNotFound } from "../shares.errors";

export interface Principal {
  type: "MEMBER" | "TEAM";
  id: string;
}

// Refuses (`principal-unknown`) a principal that is not a current member of
// the workspace or one of its teams: malformed, unknown, another workspace's
// and a member who left are one answer.
export async function assertPrincipal(
  where: { database: unknown; core: MembersMongo; workspaceId: string },
  principal: Principal,
): Promise<void> {
  if (!tryObjectId(principal.id)) throw principalUnknown();
  if (principal.type === "MEMBER") {
    const known = await activeMemberIds(where.core, where.workspaceId, [
      principal.id,
    ]);
    if (!known.has(principal.id)) throw principalUnknown();
    return;
  }
  try {
    await getTeam(teamsMongo(where.database), principal.id);
  } catch {
    throw principalUnknown();
  }
}

// Shares a node with a member or a team: `already-shared` when the node has a
// grant for that principal already.
export const grantNode = (
  database: unknown,
  input: {
    nodeId: string;
    principal: Principal;
    role: GrantRole;
    accountId: string;
  },
): Promise<GrantDoc> =>
  shared(() =>
    sharesMongo(database)
      .db.grants.as(input.accountId)
      .create({
        nodeId: toObjectId(input.nodeId),
        principal: {
          type: input.principal.type,
          id: toObjectId(input.principal.id),
        },
        role: input.role,
        grantedBy: input.accountId,
      }),
  );

// The grant with this id, on this node, or 404.
export async function grantOf(
  database: unknown,
  nodeId: string,
  id: string,
): Promise<GrantDoc> {
  const objectId = tryObjectId(id);
  const grant =
    objectId &&
    (await sharesMongo(database).db.grants.findFirst({
      _id: objectId,
      nodeId: toObjectId(nodeId),
    }));
  if (!grant) throw shareNotFound();
  return grant;
}

// Changes the role of a grant of the node.
export async function regrant(
  database: unknown,
  input: { nodeId: string; id: string; role: GrantRole; accountId: string },
): Promise<{ grant: GrantDoc; before: GrantDoc }> {
  const before = await grantOf(database, input.nodeId, input.id);
  const grant = await sharesMongo(database)
    .db.grants.as(input.accountId)
    .update(before._id, { role: input.role });
  return { grant, before };
}

// Ends a grant: the next read by the principal is a 404.
export async function revoke(
  database: unknown,
  input: { nodeId: string; id: string },
): Promise<GrantDoc> {
  const before = await grantOf(database, input.nodeId, input.id);
  await sharesMongo(database).db.grants.deleteMany({ _id: before._id });
  return before;
}

// The grants of a node, oldest first.
export const grantsOnNode = (database: unknown, nodeId: string) =>
  sharesMongo(database).db.grants.findMany({
    filter: { nodeId: toObjectId(nodeId) },
    sort: { _id: 1 },
  });

// Drops every grant on these nodes (they were purged for good).
export async function dropGrants(
  database: unknown,
  nodeIds: readonly string[],
): Promise<void> {
  if (nodeIds.length === 0) return;
  await sharesMongo(database).db.grants.deleteMany({
    nodeId: { $in: nodeIds.map((id) => toObjectId(id)) },
  });
}

// Ends what a member who leaves held and gave: the grants made to them, and
// the grants they made (a rejoin reuses the member row and must not bring the
// old shares back, and a leaver's shares end with them). `accountId` is the
// account that was the member.
export async function dropMemberGrants(
  database: unknown,
  who: { memberId: string; accountId: string },
): Promise<void> {
  await sharesMongo(database).db.grants.deleteMany({
    $or: [
      {
        "principal.type": "MEMBER",
        "principal.id": toObjectId(who.memberId),
      },
      { grantedBy: who.accountId },
    ],
  });
}

// The ids of the nodes that carry a grant the account made, each once.
export async function grantedBy(
  database: unknown,
  accountId: string,
): Promise<ReturnType<typeof toObjectId>[]> {
  const grants = await sharesMongo(database).db.grants.findMany({
    filter: { grantedBy: accountId },
  });
  const seen = new Map(grants.map((g) => [g.nodeId.toHexString(), g.nodeId]));
  return [...seen.values()];
}
