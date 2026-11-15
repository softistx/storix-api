import {
  byName,
  ensureRoot,
  type NodeDoc,
  type NodesMongo,
  ownedFolder,
  ownedNode,
} from "./nodes.service";

// The caller's roots: their "My files", made if it is missing.
export async function rootsOf(
  mongo: NodesMongo,
  accountId: string,
): Promise<NodeDoc[]> {
  return [await ensureRoot(mongo, accountId)];
}

// The live folders directly under a folder of the caller's tree, by name; with
// no parent, the roots.
export async function foldersOf(
  mongo: NodesMongo,
  parentId: string | null | undefined,
  accountId: string,
): Promise<NodeDoc[]> {
  if (!parentId) return rootsOf(mongo, accountId);
  const parent = await ownedFolder(mongo, parentId, accountId);
  return mongo.db.nodes.findMany({
    filter: { parentId: parent._id, type: "FOLDER", trashedAt: null },
    ...byName,
  });
}

// The way down to a node, root first, the node last: the breadcrumb.
export async function pathTo(
  mongo: NodesMongo,
  id: string,
  accountId: string,
): Promise<NodeDoc[]> {
  const node = await ownedNode(mongo, id, accountId);
  const above = await mongo.db.nodes.findMany({
    filter: { _id: { $in: node.ancestors } },
  });
  const byId = new Map(above.map((doc) => [doc.id, doc]));
  const path = node.ancestors.flatMap((a) => byId.get(a.toHexString()) ?? []);
  return [...path, node];
}

// The node as the API says it.
export const nodeView = (node: NodeDoc) => ({
  id: node.id,
  type: node.type,
  name: node.name,
  parentId: node.parentId?.toHexString() ?? null,
  ancestors: node.ancestors.map((a) => a.toHexString()),
  depth: node.ancestors.length + 1,
  version: node.version,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
});
