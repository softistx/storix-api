import { accountOf, type Who } from "@/core/members";
import type { NodeDoc, NodesMongo } from "../models";
import { byName } from "../utils";
import { ensureRoot, folderFor, nodeFor } from "./nodes.service";

// The caller's roots: their "My files", made if it is missing.
export async function rootsOf(
  mongo: NodesMongo,
  accountId: Who,
): Promise<NodeDoc[]> {
  return [await ensureRoot(mongo, accountOf(accountId))];
}

// The live folders directly under a folder of the caller's tree, by name; with
// no parent, the roots.
export async function foldersOf(
  mongo: NodesMongo,
  parentId: string | null | undefined,
  accountId: Who,
): Promise<NodeDoc[]> {
  if (!parentId) return rootsOf(mongo, accountId);
  const parent = await folderFor(mongo, parentId, accountId, "VIEWER");
  return mongo.db.nodes.findMany({
    filter: { parentId: parent._id, type: "FOLDER", trashedAt: null },
    ...byName,
  });
}

// The way down to a node, root first, the node last: the breadcrumb.
export async function pathTo(
  mongo: NodesMongo,
  id: string,
  accountId: Who,
): Promise<NodeDoc[]> {
  const node = await nodeFor(mongo, id, accountId, "VIEWER");
  const above = await mongo.db.nodes.findMany({
    filter: { _id: { $in: node.ancestors } },
  });
  const byId = new Map(above.map((doc) => [doc.id, doc]));
  const path = node.ancestors.flatMap((a) => byId.get(a.toHexString()) ?? []);
  return [...path, node];
}
