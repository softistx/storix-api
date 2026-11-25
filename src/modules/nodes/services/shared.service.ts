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

// What the caller shares: the live nodes whose grants they made, the topmost
// only (a node under another one they shared is left to it).
export async function sharedByMe(database: unknown, input: SharedInput) {
  const ids = await grantedBy(database, accountOf(input.who));
  return pageNodes((q) => nodesMongo(database).db.nodes.findMany(q), {
    base: [{ _id: { $in: ids }, trashedAt: null, ancestors: { $nin: ids } }],
    order: orderOf("NAME", 1),
    scope: JSON.stringify(["shared", "by-me"]),
    first: input.first,
    after: input.after,
  });
}
