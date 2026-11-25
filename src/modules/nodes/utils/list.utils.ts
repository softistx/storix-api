import type { Filter } from "mongodb";
import type { Who } from "@/core/members";
import { fileFamilies, NAME_COLLATION } from "../models";
import { decodeCursor, encodeCursor, type FileFamily } from "../rules";

export type SortBy = "NAME" | "DATE" | "SIZE" | "KIND";

export interface ListInput {
  parentId: string;
  accountId: Who;
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

export const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The positions after one: a node comes after when, on the first field that
// differs, it is further along the sort. A null (a folder's size) has nothing
// beyond it within its type, so only equality continues.
export function after(
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

export interface Order {
  key: string;
  dir: 1 | -1;
}

// The filter a listing applies under a folder: live children, narrowed by
// family (any of), tags (all of) and a name fragment (case ignored). Folders
// have neither a family nor tags, so those two leave them out.
export function filterOf(
  parentId: unknown,
  families: readonly string[],
  tags: readonly string[],
  name: string,
): Filter<Record<string, unknown>>[] {
  const base: Filter<Record<string, unknown>>[] = [
    { parentId, trashedAt: null },
  ];
  if (families.length > 0) base.push({ family: { $in: families } });
  if (tags.length > 0) base.push({ tags: { $all: tags } });
  if (name !== "") {
    base.push({ name: { $regex: escapeRegex(name), $options: "i" } });
  }
  return base;
}

// The families of a filter that exist, each once.
export const familiesOf = (families: readonly string[] | null | undefined) =>
  [...new Set(families ?? [])].filter((f) =>
    (fileFamilies as readonly string[]).includes(f),
  );

// Folders (-1 on `type`) come first; the rest follows the direction.
export const orderOf = (by: SortBy, direction: 1 | -1): Order[] => [
  { key: "type", dir: -1 },
  ...KEYS[by].map((key) => ({ key, dir: direction })),
  { key: "_id", dir: direction },
];

// One page of nodes: `base` narrowed past the cursor `after` (bound to
// `scope`), read through `find` with `first + 1` nodes to know whether more
// follow, and the cursor of the last one kept when they do.
export async function pageNodes<T extends object>(
  find: (query: {
    filter: never;
    sort: never;
    collation: typeof NAME_COLLATION;
    limit: number;
  }) => Promise<T[]>,
  page: {
    base: Record<string, unknown>[];
    order: readonly Order[];
    scope: string;
    first: number;
    after?: string | null | undefined;
  },
) {
  const and = [...page.base];
  if (page.after) {
    const values = decodeCursor(page.scope, page.after, page.order.length);
    and.push({ $or: after(page.order, values) });
  }
  const docs = await find({
    filter: { $and: and } as never,
    sort: Object.fromEntries(page.order.map((o) => [o.key, o.dir])) as never,
    collation: NAME_COLLATION,
    limit: page.first + 1,
  });
  const items = docs.slice(0, page.first);
  const last = items.at(-1) as Record<string, unknown> | undefined;
  const more = docs.length > page.first;
  return {
    items,
    endCursor:
      last && more
        ? encodeCursor(
            page.scope,
            page.order.map((o) => last[o.key]),
          )
        : null,
  };
}
