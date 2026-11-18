import { type NodeDoc, nodeNotFound, ownedNode } from "@/modules/nodes/public";
import { notAFile } from "./files.errors";
import type { FilesMongo } from "./files.handle";
import {
  afterPosition,
  type PersonalPage,
  personalPage,
} from "./files.personal";

// The most recents one account keeps: the oldest go first.
export const MAX_RECENTS = 200;

// Notes that the account opened or uploaded a file, now: one row per file, so
// a file opened again moves to the top instead of repeating. Past
// `MAX_RECENTS` the oldest rows are removed.
export async function recordRecent(
  mongo: FilesMongo,
  input: { accountId: string; nodeId: NodeDoc["_id"] },
): Promise<void> {
  await mongo.db.recents.upsert(
    { accountId: input.accountId, nodeId: input.nodeId },
    { at: new Date() },
  );
  const stale = await mongo.db.recents.findMany({
    filter: { accountId: input.accountId },
    sort: { at: -1, _id: -1 },
    skip: MAX_RECENTS,
    limit: 100,
  });
  if (stale.length > 0) {
    await mongo.db.recents.deleteMany({
      _id: { $in: stale.map((row) => row._id) },
    });
  }
}

// Opens a file of the caller's tree: it is noted as recent, and answered.
// `not-a-file` for a folder, 404 for a trashed or another member's node.
export async function openFile(
  mongo: FilesMongo,
  input: { id: string; accountId: string },
): Promise<NodeDoc> {
  const node = await ownedNode(mongo, input.id, input.accountId);
  if (node.trashedAt) throw nodeNotFound();
  if (node.type !== "FILE") throw notAFile();
  await recordRecent(mongo, { accountId: input.accountId, nodeId: node._id });
  return node;
}

// The caller's recent files, latest first, one page; a file that is trashed
// or gone is left out.
export function listRecent(
  mongo: FilesMongo,
  input: {
    accountId: string;
    first: number;
    after?: string | null | undefined;
  },
): Promise<PersonalPage> {
  return personalPage(mongo, {
    scope: JSON.stringify(["recents", input.accountId]),
    accountId: input.accountId,
    first: input.first,
    after: input.after,
    filesOnly: true,
    fetch: async (after, limit) => {
      const rows = await mongo.db.recents.findMany({
        filter: { accountId: input.accountId, ...afterPosition("at", after) },
        sort: { at: -1, _id: -1 },
        limit,
      });
      return rows.map((row) => ({
        _id: row._id,
        nodeId: row.nodeId,
        date: row.at,
      }));
    },
  });
}
