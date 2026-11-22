import { type Filter, ObjectId } from "mongodb";
import { fail } from "@/i18n/fail";
import {
  decodeCursor,
  encodeCursor,
  type NodeDoc,
  type NodesMongo,
} from "@/modules/nodes/public";

// The caller's trash entries, newest first, one page. The keyset is
// `[trashedAt, _id]`, both descending: nodes trashed together share an instant,
// so the id ends the order and a cursor never skips or repeats one.
export async function listTrash(
  mongo: NodesMongo,
  input: {
    accountId: string;
    first: number;
    after?: string | null | undefined;
  },
): Promise<{ items: NodeDoc[]; endCursor: string | null }> {
  const scope = JSON.stringify(["trash", input.accountId]);
  const base: Filter<Record<string, unknown>>[] = [
    {
      ownerId: input.accountId,
      trashedAt: { $type: "date" },
      trashRootId: null,
    },
  ];
  if (input.after) {
    const [at, id] = decodeCursor(scope, input.after, 2);
    if (!(at instanceof Date) || !(id instanceof ObjectId)) {
      throw fail("validation.errors.invalid-cursor", {
        status: 400,
        field: "after",
      });
    }
    base.push({
      $or: [{ trashedAt: { $lt: at } }, { trashedAt: at, _id: { $lt: id } }],
    });
  }
  const docs = await mongo.db.nodes.findMany({
    filter: { $and: base } as never,
    sort: { trashedAt: -1, _id: -1 } as never,
    limit: input.first + 1,
  });
  const items = docs.slice(0, input.first);
  const last = items.at(-1);
  const more = docs.length > input.first;
  return {
    items,
    endCursor:
      last && more ? encodeCursor(scope, [last.trashedAt, last._id]) : null,
  };
}
