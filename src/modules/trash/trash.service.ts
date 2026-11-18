import type { WorkspacesMongo } from "@/core/workspaces";
import { accounted, type FilesMongo } from "@/modules/files/public";
import {
  assertMovable,
  ensureRoot,
  freeName,
  lockTree,
  moveOne,
  type NodeDoc,
  named,
  nodeNotFound,
  nodesMongo,
  ownedNode,
  rootLocked,
} from "@/modules/nodes/public";
import { blobKeysOf, entryOf, inSession, topsOf } from "./trash.tree";

interface Done {
  workspaceId: string;
  accountId: string;
  ids: readonly string[];
}

async function reread(tx: FilesMongo, nodes: readonly NodeDoc[]) {
  const found: NodeDoc[] = [];
  for (const node of nodes) {
    const fresh = await tx.db.nodes.findFirst({ _id: node._id });
    if (fresh) found.push(fresh);
  }
  return found;
}

// Moves nodes to the trash, all or nothing. A selected node that sits under
// another selected node goes with it and is not listed. The top node gets
// `trashedAt` and `trashedBy` and is the trash's entry; everything live under
// it gets the same stamp and `trashRootId` = the top, so a restore brings back
// that subtree and not what was trashed before it. The bytes the nodes held
// become the trash's (`trashBytes`) when no live node holds them any more.
// `nodes.errors.not-found` (also for a trashed node), `root-locked`,
// `move-too-large` (a folder with more than `MAX_MOVE_NODES` nodes under it).
export async function trashNodes(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: Done,
): Promise<NodeDoc[]> {
  return named(() =>
    mongo.transaction(async (tx) => {
      const nodes = nodesMongo(tx);
      await lockTree(nodes, input.accountId);
      const selected: NodeDoc[] = [];
      for (const id of new Set(input.ids)) {
        selected.push(await ownedNode(nodes, id, input.accountId));
      }
      if (selected.some((node) => node.parentId === null)) throw rootLocked();
      const tops = topsOf(selected);
      // A subtree past what a move allows is refused, counted as `moveOne` does,
      // so what goes to the trash can always be restored.
      for (const top of tops) {
        if (top.type !== "FOLDER") continue;
        await assertMovable(nodes, top);
      }
      const at = new Date();
      for (const top of tops) {
        const live = {
          $or: [{ _id: top._id }, { ancestors: top._id, trashedAt: null }],
        };
        const keys = await blobKeysOf(tx, live);
        const files = await tx.db.nodes.raw.countDocuments(
          { type: "FILE", ...live },
          inSession(tx),
        );
        await accounted(
          tx,
          core,
          input.workspaceId,
          keys,
          async () => {
            await tx.db.nodes.raw.updateMany(
              { ancestors: top._id, trashedAt: null },
              {
                $set: {
                  trashedAt: at,
                  trashedBy: input.accountId,
                  trashRootId: top._id,
                },
              },
              inSession(tx),
            );
            await tx.db.nodes.raw.updateOne(
              { _id: top._id },
              {
                $set: {
                  trashedAt: at,
                  trashedBy: input.accountId,
                  trashRootId: null,
                },
              },
              inSession(tx),
            );
          },
          () => -files,
        );
      }
      return reread(tx, tops);
    }),
  );
}

// Brings trashed entries back, each with the subtree that went with it. The
// node returns to its folder when that is live, else to the owner's root; a
// name a live sibling holds there becomes `name (1)` (`freeName`). A restore
// never fails on a name. `trash.errors.not-trashed` for a live node,
// `nodes.errors.not-found` for a node that is not an entry, `too-deep` when
// the root is deeper than the subtree allows (it is not), `move-too-large` for
// an entry with more than `MAX_MOVE_NODES` nodes under it (a restore is a move).
export async function restoreNodes(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: Done,
): Promise<NodeDoc[]> {
  const root = await ensureRoot(nodesMongo(mongo), input.accountId);
  return named(() =>
    mongo.transaction(async (tx) => {
      const nodes = nodesMongo(tx);
      await lockTree(nodes, input.accountId);
      const restored: NodeDoc[] = [];
      for (const id of new Set(input.ids)) {
        const node = await entryOf(nodes, id, input.accountId);
        const parent = node.parentId
          ? await tx.db.nodes.findFirst({ _id: node.parentId, trashedAt: null })
          : undefined;
        const target = parent ?? root;
        const name = await freeName(nodes, target, node.name);
        const subtree = { $or: [{ _id: node._id }, { trashRootId: node._id }] };
        const keys = await blobKeysOf(tx, subtree);
        const files = await tx.db.nodes.raw.countDocuments(
          { type: "FILE", ...subtree },
          inSession(tx),
        );
        await accounted(
          tx,
          core,
          input.workspaceId,
          keys,
          async () => {
            await moveOne(nodes, node, target, input.accountId);
            await tx.db.nodes.raw.updateOne(
              { _id: node._id },
              { $set: { trashedAt: null, trashedBy: null, name } },
              inSession(tx),
            );
            await tx.db.nodes.raw.updateMany(
              { trashRootId: node._id },
              {
                $set: { trashedAt: null, trashedBy: null, trashRootId: null },
              },
              inSession(tx),
            );
          },
          () => files,
        );
        const back = await tx.db.nodes.findFirst({ _id: node._id });
        if (!back) throw nodeNotFound();
        restored.push(back);
      }
      return restored;
    }),
  );
}
