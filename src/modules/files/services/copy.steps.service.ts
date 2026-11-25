import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  cycle,
  depthOf,
  type NodeDoc,
  rootLocked,
  tooDeep,
} from "@/modules/nodes/public";
import { copyTooLarge } from "../files.errors";
import type { FilesMongo } from "../models";
import type { CopyLimits } from "./copy.service";

// What a copy of `top` would add under `target`, checked before anything is
// written: a root is locked, a folder never goes into itself or its own
// subtree, the copy stays under the node and depth limits. Answers the live
// nodes under `top`.
export async function checkedBelow(
  tx: FilesMongo,
  input: {
    top: NodeDoc;
    target: NodeDoc;
    made: number;
    limits: CopyLimits;
  },
): Promise<NodeDoc[]> {
  const { top, target, limits } = input;
  if (top.parentId === null) throw rootLocked();
  if (top._id.equals(target._id)) throw cycle();
  if (target.ancestors.some((a) => a.equals(top._id))) throw cycle();
  const below =
    top.type === "FOLDER"
      ? await tx.db.nodes.findMany({
          filter: { ancestors: top._id, trashedAt: null },
          limit: limits.maxNodes + 1,
        })
      : [];
  if (input.made + 1 + below.length > limits.maxNodes) throw copyTooLarge();
  const deepest = Math.max(depthOf(top), ...below.map((n) => depthOf(n)));
  if (depthOf(target) + 1 + (deepest - depthOf(top)) > limits.maxDepth) {
    throw tooDeep();
  }
  return below;
}

// The copies share the blobs: each key is held once more per copy. The
// workspace holds no more bytes (a shared blob counts once) and as many more
// files as there are copies of files.
export async function holdCopiedBlobs(
  tx: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  refs: ReadonlyMap<string, number>,
): Promise<void> {
  let copiedFiles = 0;
  for (const [key, count] of refs) {
    await tx.db.blobs.updateMany({ key }, { $inc: { refs: count } });
    copiedFiles += count;
  }
  if (copiedFiles > 0) {
    await addUsage(core.withSession(tx.session), workspaceId, {
      bytes: 0,
      files: copiedFiles,
    });
  }
}
