import type { Filter } from "mongodb";
import { fileFamilies, NAME_COLLATION } from "./nodes.collection";
import { decodeCursor, encodeCursor } from "./nodes.cursor";
import type { FileFamily } from "./nodes.family";
import { type NodesMongo, ownedFolder } from "./nodes.service";

export type SortBy = "NAME" | "DATE" | "SIZE" | "KIND";

export interface ListInput {
  parentId: string;
  accountId: string;
  filter?:
    | {
        families?: readonly FileFamily[] | null | undefined;
        tags?: readonly string[] | null | undefined;
        name?: string | null | undefined;
      }
    | null
    | undefined;
  sort?:
    | {
        by?: SortBy | null | undefined;
        direction?: "ASC" | "DESC" | null | undefined;
      }
    | null
    | undefined;
  first: number;
  after?: string | null | undefined;
}

// What a listing is ordered by, folders first whatever the direction, then the
// sort's own fields, ending in the id: no two nodes share a position, so a
// cursor never skips or repeats one under any sort (plan §3.3).
const KEYS: Record<SortBy, readonly string[]> = {
  NAME: ["name"],
  DATE: ["updatedAt"],
  SIZE: ["size", "name"],
  KIND: ["family", "name"],
};

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The nodes directly under a folder of the caller's tree, one page: filtered
// by family (any of), tags (all of) and a name fragment (case ignored), sorted
// by name, date, size or kind, paged by cursor. A filter on family or tags
// leaves the folders out, as they have neither.
export async function listNodes(mongo: NodesMongo, input: ListInput) {
  const parent = await ownedFolder(mongo, input.parentId, input.accountId);
  const by = input.sort?.by ?? "NAME";
  const direction: 1 | -1 = input.sort?.direction === "DESC" ? -1 : 1;
  const filter = input.filter ?? {};
  const families = [...new Set(filter.families ?? [])].filter((f) =>
    (fileFamilies as readonly string[]).includes(f),
  );
  const tags = [...new Set(filter.tags ?? [])];
  const name = filter.name?.trim() ?? "";

  const base: Filter<Record<string, unknown>>[] = [
    { parentId: parent._id, trashedAt: null },
  ];
  if (families.length > 0) base.push({ family: { $in: families } });
  if (tags.length > 0) base.push({ tags: { $all: tags } });
  if (name !== "") {
    base.push({ name: { $regex: escapeRegex(name), $options: "i" } });
  }

  // Folders (-1 on `type`) come first; the rest follows the direction.
  const order: { key: string; dir: 1 | -1 }[] = [
    { key: "type", dir: -1 },
    ...KEYS[by].map((key) => ({ key, dir: direction })),
    { key: "_id", dir: direction },
  ];
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

// The positions after one: a node comes after when, on the first field that
// differs, it is further along the sort. A null (a folder's size) has nothing
// beyond it within its type, so only equality continues.
function after(
  order: readonly { key: string; dir: 1 | -1 }[],
  values: readonly unknown[],
): Record<string, unknown>[] {
  const branches: Record<string, unknown>[] = [];
  for (let i = 0; i < order.length; i++) {
    const step = order[i];
    if (!step) continue;
    const value = values[i];
    const before: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) {
      const prior = order[j];
      if (prior) before[prior.key] = values[j] ?? null;
    }
    if (value === null || value === undefined) continue;
    branches.push({
      ...before,
      [step.key]: { [step.dir === 1 ? "$gt" : "$lt"]: value },
    });
  }
  return branches;
}
