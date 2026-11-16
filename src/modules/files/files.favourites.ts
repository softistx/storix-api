import { type NodeDoc, ownedNode } from "@/modules/nodes/public";
import {
  afterPosition,
  type PersonalPage,
  personalPage,
} from "./files.personal";
import type { FilesMongo } from "./files.service";

// Stars or unstars a node of the caller's tree, and answers the node. Starring
// is idempotent (the list keeps the first date) and so is unstarring; a
// trashed node cannot be starred (404, as if it were gone) but its star can be
// removed. A node of another member is a 404 either way.
export async function setStarred(
  mongo: FilesMongo,
  input: { id: string; starred: boolean; accountId: string },
): Promise<NodeDoc> {
  const node = await ownedNode(
    mongo,
    input.id,
    input.accountId,
    input.starred ? "live" : "any",
  );
  if (input.starred) {
    await mongo.db.stars.upsert(
      { accountId: input.accountId, nodeId: node._id },
      {},
    );
  } else {
    await mongo.db.stars.deleteMany({
      accountId: input.accountId,
      nodeId: node._id,
    });
  }
  return node;
}

// The caller's favourites, newest star first, one page: the nodes of their
// tree that are still live. A trashed node leaves the list and comes back with
// its restore.
export function listStarred(
  mongo: FilesMongo,
  input: {
    accountId: string;
    first: number;
    after?: string | null | undefined;
  },
): Promise<PersonalPage> {
  return personalPage(mongo, {
    scope: JSON.stringify(["stars", input.accountId]),
    accountId: input.accountId,
    first: input.first,
    after: input.after,
    filesOnly: false,
    fetch: async (after, limit) => {
      const rows = await mongo.db.stars.findMany({
        filter: {
          accountId: input.accountId,
          ...afterPosition("createdAt", after),
        },
        sort: { createdAt: -1, _id: -1 },
        limit,
      });
      return rows.map((row) => ({
        _id: row._id,
        nodeId: row.nodeId,
        date: row.createdAt,
      }));
    },
  });
}
