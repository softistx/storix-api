import { accountOf, type Who } from "@/core/members";
import { allGrantedNodeIds, grantedNodeIds } from "@/modules/shares/public";
import { NAME_COLLATION, nodesMongo } from "../models";
import { decodeCursor, encodeCursor } from "../rules";
import { after, orderOf } from "../utils";

export interface SharedInput {
  who: Who;
  first: number;
  after?: string | null | undefined;
}

// One page of a shared listing: the nodes `filter` keeps, folders first then
// by name, paged by cursor bound to the listing (`kind`).
export async function pageShared(
  database: unknown,
  kind: "with-me" | "by-me",
  filter: Record<string, unknown>,
  input: SharedInput,
) {
  const order = orderOf("NAME", 1);
  const scope = JSON.stringify(["shared", kind]);
  const and: Record<string, unknown>[] = [filter];
  if (input.after) {
    const values = decodeCursor(scope, input.after, order.length);
    and.push({ $or: after(order, values) });
  }
  const docs = await nodesMongo(database).db.nodes.findMany({
    filter: { $and: and } as never,
    sort: Object.fromEntries(order.map((o) => [o.key, o.dir])) as never,
    collation: NAME_COLLATION,
    limit: input.first + 1,
  });
  const items = docs.slice(0, input.first);
  const last = items.at(-1);
  const more = docs.length > input.first;
  return {
    items,
    endCursor:
      last && more
        ? encodeCursor(
            scope,
            order.map((o) => (last as Record<string, unknown>)[o.key]),
          )
        : null,
  };
}

// What is shared with the caller, by their member or one of their teams: the
// topmost shared node only, never a node under another one that is shared
// with them too. The caller's own nodes and trashed ones are left out.
export async function sharedWithMe(database: unknown, input: SharedInput) {
  const ids = await grantedNodeIds(database, input.who);
  if (ids.length === 0) return { items: [], endCursor: null };
  return pageShared(
    database,
    "with-me",
    {
      _id: { $in: ids },
      trashedAt: null,
      ownerId: { $ne: accountOf(input.who) },
      ancestors: { $nin: ids },
    },
    input,
  );
}

// What the caller shares: their own live nodes that carry a grant, the topmost
// only (a node under another one that carries grants is left to it).
export async function sharedByMe(database: unknown, input: SharedInput) {
  const ids = await allGrantedNodeIds(database);
  if (ids.length === 0) return { items: [], endCursor: null };
  return pageShared(
    database,
    "by-me",
    {
      _id: { $in: ids },
      trashedAt: null,
      ownerId: accountOf(input.who),
      ancestors: { $nin: ids },
    },
    input,
  );
}
