import { toObjectId } from "@softistx/mongo";
import { accountOf, memberOf, type Who } from "@/core/members";
import { teamIdsOfMember, teamsMongo } from "@/modules/teams/public";
import { sharesMongo } from "../models";
import { type Role, strongest } from "../rules";

// What the role of a node is computed from: its id, the ids above it and the
// account that owns its tree.
export interface RoleNode {
  _id: { toHexString(): string };
  ancestors: readonly { toHexString(): string }[];
  ownerId: string | null;
}

// The caller's effective role on a node (plan §3.6): OWNER for the account that
// owns the tree, otherwise the highest of the grants on the node or on any
// folder above it that name the caller's member or one of the caller's teams.
// Null is no access at all, which every read answers as a missing node. A bare
// account id (no member) holds no grant, so it reaches only what it owns.
// `database` is the workspace's database or a transaction on it.
export async function roleOn(
  database: unknown,
  who: Who,
  node: RoleNode,
): Promise<Role | null> {
  if (node.ownerId !== null && node.ownerId === accountOf(who)) return "OWNER";
  const memberId = memberOf(who);
  if (memberId === null) return null;
  const teamIds = await teamIdsOfMember(teamsMongo(database), memberId);
  const grants = await sharesMongo(database).db.grants.findMany({
    filter: {
      nodeId: {
        $in: [...node.ancestors, node._id].map((id) =>
          toObjectId(id.toHexString()),
        ),
      },
      $or: [
        { "principal.type": "MEMBER", "principal.id": toObjectId(memberId) },
        { "principal.type": "TEAM", "principal.id": { $in: teamIds } },
      ],
    },
  });
  return strongest(grants.map((grant) => grant.role));
}
