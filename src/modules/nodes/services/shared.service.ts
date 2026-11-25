import { accountOf, type Who } from "@/core/members";
import { grantedBy, grantedNodeIds } from "@/modules/shares/public";
import { nodesMongo } from "../models";
import { orderOf, pageNodes } from "../utils";

export interface SharedInput {
  who: Who;
  first: number;
  after?: string | null | undefined;
}

// An empty id set still goes through the paging, so a cursor of another
// listing is refused whatever the caller holds.
// What is shared with the caller, by their member or one of their teams: the
// topmost shared node only, never a node under another one that is shared
// with them too. The caller's own nodes and trashed ones are left out.
export async function sharedWithMe(database: unknown, input: SharedInput) {
  const ids = await grantedNodeIds(database, input.who);
  return pageNodes((q) => nodesMongo(database).db.nodes.findMany(q), {
    base: [
      {
        _id: { $in: ids },
        trashedAt: null,
        ownerId: { $ne: accountOf(input.who) },
        ancestors: { $nin: ids },
      },
    ],
    order: orderOf("NAME", 1),
    scope: JSON.stringify(["shared", "with-me"]),
    first: input.first,
    after: input.after,
  });
}

// What the caller shares: the live nodes whose grants they made and that they
// can still read (their own, or under a grant they hold), the topmost only. A
// node under another readable shared one is left to it; one under a shared
// node the caller can no longer read is their topmost readable node. A revoked
// editor, or a node moved out of their reach, drops out of the list.
export async function sharedByMe(database: unknown, input: SharedInput) {
  const made = await grantedBy(database, accountOf(input.who));
  const held = await grantedNodeIds(database, input.who);
  const mongo = nodesMongo(database);
  const readable = (
    await mongo.db.nodes.findMany({
      filter: {
        _id: { $in: made },
        $or: [
          { ownerId: accountOf(input.who) },
          { _id: { $in: held } },
          { ancestors: { $in: held } },
        ],
      },
    })
  ).map((node) => node._id);
  return pageNodes((q) => mongo.db.nodes.findMany(q), {
    base: [
      {
        _id: { $in: readable },
        trashedAt: null,
        ancestors: { $nin: readable },
      },
    ],
    order: orderOf("NAME", 1),
    scope: JSON.stringify(["shared", "by-me"]),
    first: input.first,
    after: input.after,
  });
}
