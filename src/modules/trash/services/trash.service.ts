import { accountOf, type Who } from "@/core/members";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { FilesMongo } from "@/modules/files/public";
import {
  assertMovable,
  ensureRoot,
  lockTree,
  lockTreesOf,
  type NodeDoc,
  named,
  nodeFor,
  nodesMongo,
  rootLocked,
} from "@/modules/nodes/public";
import { topsOf } from "../utils";
import {
  entryOf,
  rereadNodes,
  restoreEntry,
  trashTop,
} from "./entries.service";

interface Done {
  workspaceId: string;
  accountId: string;
  ids: readonly string[];
}

// Who trashes: an owner or an editor of each node (a grant reaches the nodes
// under a shared folder). The entry lands in the owner's trash.
interface Trashing {
  workspaceId: string;
  accountId: Who;
  ids: readonly string[];
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
  input: Trashing,
): Promise<NodeDoc[]> {
  const by = { ...input, accountId: accountOf(input.accountId) };
  return named(() =>
    mongo.transaction(async (tx) => {
      const nodes = nodesMongo(tx);
      await lockTreesOf(nodes, input.ids);
      const selected: NodeDoc[] = [];
      for (const id of new Set(input.ids)) {
        selected.push(await nodeFor(nodes, id, input.accountId, "EDITOR"));
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
      for (const top of tops) await trashTop(tx, core, by, top, at);
      return rereadNodes(tx, tops);
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
        restored.push(await restoreEntry(tx, core, input, nodes, node, root));
      }
      return restored;
    }),
  );
}
