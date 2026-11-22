import { ObjectId } from "mongodb";
import { fail } from "@/i18n/fail";
import type { NodeDoc } from "@/modules/nodes/public";
import { decodeCursor, encodeCursor } from "@/modules/nodes/public";
import type { FilesMongo } from "../models";

// What a member's personal lists (favourites, recents) have in common: a row
// points at a node and sits at a position `[date, _id]`, newest first. A row
// whose node is trashed, gone or no longer the caller's to read is skipped
// when the list is read, not deleted: a trash or an unshare writes nothing
// here, and a restore brings the row back (plan §3.3).

export interface Row {
  _id: ObjectId;
  nodeId: ObjectId;
  // The sort date: when it was starred, or last opened.
  date: Date;
}

export interface PersonalPage {
  items: NodeDoc[];
  endCursor: string | null;
}

// How many rows one read looks at. Rows that no longer count are skipped, so
// a page may take several reads; each is bounded.
const BATCH = 100;

// How many reads one page takes at most (so `BATCH * MAX_READS` rows looked
// at). A list buried under dead rows (trashed, gone) answers a short page with
// a cursor at the last row looked at, instead of scanning them all; the next
// page goes on from there.
export const MAX_READS = 20;

// The newest-first rows of an account after a position (`null` is the start),
// at most `limit`.
export type Fetch = (
  after: { date: Date; _id: ObjectId } | null,
  limit: number,
) => Promise<Row[]>;

export async function personalPage(
  mongo: FilesMongo,
  input: {
    // Binds the cursor to its list and account.
    scope: string;
    accountId: string;
    first: number;
    after: string | null | undefined;
    fetch: Fetch;
    // Recents are files only; favourites are any node.
    filesOnly: boolean;
  },
): Promise<PersonalPage> {
  let position: { date: Date; _id: ObjectId } | null = null;
  if (input.after) {
    const [date, id] = decodeCursor(input.scope, input.after, 2);
    if (!(date instanceof Date) || !(id instanceof ObjectId)) {
      throw fail("validation.errors.invalid-cursor", {
        status: 400,
        field: "after",
      });
    }
    position = { date, _id: id };
  }
  const items: { node: NodeDoc; row: Row }[] = [];
  // Set when the scan stopped on its cap with rows maybe left.
  let resume: { date: Date; _id: ObjectId } | null = null;
  for (let reads = 0; ; reads++) {
    if (reads === MAX_READS) {
      resume = position;
      break;
    }
    const rows = await input.fetch(position, BATCH);
    if (rows.length === 0) break;
    const nodes = await mongo.db.nodes.findMany({
      filter: {
        _id: { $in: rows.map((row) => row.nodeId) },
        ownerId: input.accountId,
        trashedAt: null,
        ...(input.filesOnly && { type: "FILE" as const }),
      },
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const row of rows) {
      const node = byId.get(row.nodeId.toHexString());
      if (node) items.push({ node, row });
      if (items.length > input.first) break;
    }
    const last = rows.at(-1);
    if (items.length > input.first || rows.length < BATCH || !last) break;
    position = { date: last.date, _id: last._id };
  }
  const page = items.slice(0, input.first);
  const tail = page.at(-1);
  return {
    items: page.map(({ node }) => node),
    endCursor:
      items.length > input.first && tail
        ? encodeCursor(input.scope, [tail.row.date, tail.row._id])
        : resume && items.length <= input.first
          ? encodeCursor(input.scope, [resume.date, resume._id])
          : null,
  };
}

// The filter of the rows after a position, newest first: a later date, or the
// same date and a later (smaller) id.
export const afterPosition = (
  field: string,
  after: { date: Date; _id: ObjectId } | null,
) =>
  after
    ? {
        $or: [
          { [field]: { $lt: after.date } },
          { [field]: after.date, _id: { $lt: after._id } },
        ],
      }
    : {};
