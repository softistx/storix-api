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

// A node whose role is asked for the page of a list: `trashed` nodes give
// their owner OWNER and nobody else a role (the grants of a trashed node have
// no effect, as `nodeFor` reads them).
export interface RoleNodeInput extends RoleNode {
  trashed?: boolean;
}

// The caller's effective role on each node (plan §3.6): OWNER for the account
// that owns the tree, otherwise the highest of the grants on the node or on any
// folder above it that name the caller's member or one of the caller's teams.
// Null is no access at all, which every read answers as a missing node. A bare
// account id (no member) holds no grant, so it reaches only what it owns.
// The teams of the caller are read once and the grants of every node and every
// ancestor with ONE `$in`, however many nodes ask. Answers one role per node, in
// order. `database` is the workspace's database or a transaction on it.
export async function rolesOn(
  database: unknown,
  who: Who,
  nodes: readonly RoleNodeInput[],
): Promise<(Role | null)[]> {
  const account = accountOf(who);
  const memberId = memberOf(who);
  const asks = nodes.map((node) =>
    node.ownerId !== null && node.ownerId === account
      ? "OWNER"
      : node.trashed || memberId === null
        ? null
        : node,
  );
  const open = asks.filter((ask) => ask !== null && ask !== "OWNER");
  if (open.length === 0 || memberId === null) {
    return asks.map((ask) => (ask === "OWNER" ? "OWNER" : null));
  }
  const ids = new Map<string, ReturnType<typeof toObjectId>>();
  for (const node of open) {
    for (const id of [...node.ancestors, node._id]) {
      ids.set(id.toHexString(), toObjectId(id.toHexString()));
    }
  }
  const teamIds = await teamIdsOfMember(teamsMongo(database), memberId);
  const grants = await sharesMongo(database).db.grants.findMany({
    filter: {
      nodeId: { $in: [...ids.values()] },
      $or: [
        { "principal.type": "MEMBER", "principal.id": toObjectId(memberId) },
        { "principal.type": "TEAM", "principal.id": { $in: teamIds } },
      ],
    },
  });
  const rolesAt = new Map<string, Role[]>();
  for (const grant of grants) {
    const key = grant.nodeId.toHexString();
    rolesAt.set(key, [...(rolesAt.get(key) ?? []), grant.role]);
  }
  return asks.map((ask) => {
    if (ask === "OWNER") return "OWNER";
    if (ask === null) return null;
    return strongest(
      [...ask.ancestors, ask._id].flatMap(
        (id) => rolesAt.get(id.toHexString()) ?? [],
      ),
    );
  });
}

// The caller's effective role on one node (`rolesOn` for a single one).
export async function roleOn(
  database: unknown,
  who: Who,
  node: RoleNode,
): Promise<Role | null> {
  const [role] = await rolesOn(database, who, [node]);
  return role ?? null;
}

// The ids of the nodes the caller holds a grant on, by member or by team: the
// roots of everything a share lets them reach. Empty for a bare account id.
export async function grantedNodeIds(
  database: unknown,
  who: Who,
): Promise<ReturnType<typeof toObjectId>[]> {
  const memberId = memberOf(who);
  if (memberId === null) return [];
  const teamIds = await teamIdsOfMember(teamsMongo(database), memberId);
  const grants = await sharesMongo(database).db.grants.findMany({
    filter: {
      $or: [
        { "principal.type": "MEMBER", "principal.id": toObjectId(memberId) },
        { "principal.type": "TEAM", "principal.id": { $in: teamIds } },
      ],
    },
  });
  return grants.map((grant) => grant.nodeId);
}
