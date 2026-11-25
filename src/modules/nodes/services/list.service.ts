import { NAME_COLLATION, type NodesMongo } from "../models";
import { decodeCursor, encodeCursor } from "../rules";
import { after, familiesOf, filterOf, type ListInput, orderOf } from "../utils";
import { folderFor } from "./nodes.service";

// The nodes directly under a folder of the caller's tree, one page: filtered
// by family (any of), tags (all of) and a name fragment (case ignored), sorted
// by name, date, size or kind, paged by cursor. A filter on family or tags
// leaves the folders out, as they have neither.
export async function listNodes(mongo: NodesMongo, input: ListInput) {
  const parent = await folderFor(
    mongo,
    input.parentId,
    input.accountId,
    "VIEWER",
  );
  const by = input.sort?.by ?? "NAME";
  const direction: 1 | -1 = input.sort?.direction === "DESC" ? -1 : 1;
  const filter = input.filter ?? {};
  const families = familiesOf(filter.families);
  const tags = [...new Set(filter.tags ?? [])];
  const name = filter.name?.trim() ?? "";
  const base = filterOf(parent._id, families, tags, name);
  const order = orderOf(by, direction);
  const scope = JSON.stringify([
    parent.id,
    by,
    direction,
    families.toSorted(),
    tags.toSorted(),
    name,
  ]);
  if (input.after) {
    const values = decodeCursor(scope, input.after, order.length);
    base.push({ $or: after(order, values) });
  }
  const docs = await mongo.db.nodes.findMany({
    filter: { $and: base } as never,
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
