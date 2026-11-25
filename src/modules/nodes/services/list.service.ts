import type { NodesMongo } from "../models";
import {
  familiesOf,
  filterOf,
  type ListInput,
  orderOf,
  pageNodes,
} from "../utils";
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
  return pageNodes((query) => mongo.db.nodes.findMany(query), {
    base,
    order,
    scope,
    first: input.first,
    after: input.after,
  });
}
