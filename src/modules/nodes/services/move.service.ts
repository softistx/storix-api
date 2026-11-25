import { accountOf, type Who } from "@/core/members";
import type { NodeDoc, NodesMongo } from "../models";
import {
  cycle,
  named,
  nodeNotFound,
  rootLocked,
  tooDeep,
} from "../nodes.errors";
import { MAX_DEPTH } from "../rules";
import { depthOf, sessionOf } from "../utils";
import {
  assertMovable,
  ensureRoot,
  folderFor,
  lockTreesOf,
  nodeFor,
} from "./nodes.service";

// Moves nodes under a folder of the caller's tree, all or nothing. A selected
// node that sits under another selected node moves with it and is not moved
// twice. Answers each moved node (as it is now) with the parent it left.
// 409 `cycle` for a folder moved into itself or its own subtree; `too-deep`
// past 16 levels; `move-too-large` when a subtree has more than 5,000 nodes;
// `name-taken` for a name the target already holds; `root-locked` for a root.
export async function moveNodes(
  mongo: NodesMongo,
  input: { ids: readonly string[]; parentId: string; accountId: Who },
): Promise<{ node: NodeDoc; from: string | null }[]> {
  await ensureRoot(mongo, accountOf(input.accountId));
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTreesOf(tx, [input.parentId, ...input.ids]);
      const target = await folderFor(
        tx,
        input.parentId,
        input.accountId,
        "EDITOR",
      );
      const selected: NodeDoc[] = [];
      for (const id of new Set(input.ids)) {
        const node = await nodeFor(tx, id, input.accountId, "EDITOR");
        // A move stays inside one owner's tree: a subtree changing owner would
        // also change whose quota holds it. The target is out of reach.
        if (node.ownerId !== target.ownerId) throw nodeNotFound();
        selected.push(node);
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
  accountId: Who,
): Promise<NodeDoc> {
  if (node.parentId === null) throw rootLocked();
  if (node._id.equals(target._id)) throw cycle();
  if (target.ancestors.some((a) => a.equals(node._id))) throw cycle();
  if (node.parentId.equals(target._id)) return node;
  const ancestors = [...target.ancestors, target._id];
  if (node.type === "FOLDER") {
    await assertMovable(tx, node);
    const deepest = await deepestBelow(tx, node);
    if (depthOf(target) + 1 + (deepest - depthOf(node)) > MAX_DEPTH) {
      throw tooDeep();
    }
  }
  const moved = await tx.db.nodes
    .as(accountOf(accountId))
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

// The depth of the deepest node under a folder, or the folder's own.
export async function deepestBelow(
  tx: NodesMongo,
  node: NodeDoc,
): Promise<number> {
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
