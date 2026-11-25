import { accountOf, type Who } from "@/core/members";
import { roleOn } from "@/modules/shares/public";
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
  return fromShare(mongo, accountId, [...path, node]);
}

// A grantee sees the path from the highest node they reach: roles come down
// the tree, so the names above the share point stay hidden.
async function fromShare(
  mongo: NodesMongo,
  who: Who,
  path: NodeDoc[],
): Promise<NodeDoc[]> {
  for (let i = 0; i < path.length; i++) {
    const at = path[i];
    if (at && (await roleOn(mongo, who, at))) return path.slice(i);
  }
  return path.slice(-1);
}
