import { MAX_DEPTH, MAX_MOVE_NODES } from "./nodes.rules";
import {
  cycle,
  depthOf,
  ensureRoot,
  lockTree,
  moveTooLarge,
  type NodeDoc,
  type NodesMongo,
  named,
  ownedFolder,
  ownedNode,
  rootLocked,
  tooDeep,
} from "./nodes.service";

// Moves nodes under a folder of the caller's tree, all or nothing. A selected
// node that sits under another selected node moves with it and is not moved
// twice. Answers each moved node (as it is now) with the parent it left.
// 409 `cycle` for a folder moved into itself or its own subtree; `too-deep`
// past 16 levels; `move-too-large` when a subtree has more than 5,000 nodes;
// `name-taken` for a name the target already holds; `root-locked` for a root.
export async function moveNodes(
  mongo: NodesMongo,
  input: { ids: readonly string[]; parentId: string; accountId: string },
): Promise<{ node: NodeDoc; from: string | null }[]> {
  await ensureRoot(mongo, input.accountId);
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTree(tx, input.accountId);
      const target = await ownedFolder(tx, input.parentId, input.accountId);
      const selected: NodeDoc[] = [];
      for (const id of new Set(input.ids)) {
        selected.push(await ownedNode(tx, id, input.accountId));
      }
      const chosen = new Set(selected.map((node) => node.id));
      const tops = selected.filter(
        (node) => !node.ancestors.some((a) => chosen.has(a.toHexString())),
      );
      const moved: { node: NodeDoc; from: string | null }[] = [];
      for (const node of tops) {
        moved.push({
          node: await moveOne(tx, node, target, input.accountId),
          from: node.parentId?.toHexString() ?? null,
        });
      }
      return moved;
    }),
  );
}

export async function moveOne(
  tx: NodesMongo,
  node: NodeDoc,
  target: NodeDoc,
  accountId: string,
): Promise<NodeDoc> {
  if (node.parentId === null) throw rootLocked();
  if (node._id.equals(target._id)) throw cycle();
  if (target.ancestors.some((a) => a.equals(node._id))) throw cycle();
  if (node.parentId.equals(target._id)) return node;
  const ancestors = [...target.ancestors, target._id];
  if (node.type === "FOLDER") {
    const below = await tx.db.nodes.count({ ancestors: node._id });
    if (below > MAX_MOVE_NODES) throw moveTooLarge();
    const deepest = await deepestBelow(tx, node);
    if (depthOf(target) + 1 + (deepest - depthOf(node)) > MAX_DEPTH) {
      throw tooDeep();
    }
  }
  const moved = await tx.db.nodes
    .as(accountId)
    .update(node._id, { parentId: target._id, ancestors });
  // The subtree keeps its place under the node: only the part above it changes.
  await tx.db.nodes.raw.updateMany(
    { ancestors: node._id },
    [
      {
        $set: {
          ancestors: {
            $concatArrays: [
              ancestors,
              { $slice: ["$ancestors", node.ancestors.length, MAX_DEPTH] },
            ],
          },
        },
      },
    ],
    sessionOf(tx),
  );
  return moved;
}

// The transaction's session, for the driver calls that take it as an option.
const sessionOf = (tx: NodesMongo) => {
  const session = tx.db.nodes.session;
  return session ? { session } : {};
};

// The depth of the deepest node under a folder, or the folder's own.
async function deepestBelow(tx: NodesMongo, node: NodeDoc): Promise<number> {
  const [deepest] = await tx.db.nodes
    .aggregate<{ depth: number }>(
      [
        { $match: { ancestors: node._id } },
        { $group: { _id: null, depth: { $max: { $size: "$ancestors" } } } },
      ],
      sessionOf(tx),
    )
    .toArray();
  return deepest ? deepest.depth + 1 : depthOf(node);
}
