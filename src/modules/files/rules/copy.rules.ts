import { depthOf, type NodeDoc } from "@/modules/nodes/public";

// The caps a copy keeps; a spec passes lower ones to reach them cheaply.
export interface CopyLimits {
  maxNodes: number;
  maxDepth: number;
}

// Why `top` can never be copied under `target`, whatever its size: a root is
// locked, and a folder never goes into itself or its own subtree.
export function copyBlocker(
  top: Pick<NodeDoc, "_id" | "parentId">,
  target: Pick<NodeDoc, "_id" | "ancestors">,
): "root-locked" | "cycle" | null {
  if (top.parentId === null) return "root-locked";
  if (top._id.equals(target._id)) return "cycle";
  if (target.ancestors.some((a) => a.equals(top._id))) return "cycle";
  return null;
}

// Whether the copy of `top` and the `below` live nodes under it, after
// `made` nodes already copied, passes a cap: `copy-too-large` for the node
// count, `too-deep` for the depth of the copy under `target`.
export function copyOverflow(input: {
  top: NodeDoc;
  target: NodeDoc;
  below: readonly NodeDoc[];
  made: number;
  limits: CopyLimits;
}): "copy-too-large" | "too-deep" | null {
  const { top, target, below, limits } = input;
  if (input.made + 1 + below.length > limits.maxNodes) return "copy-too-large";
  const deepest = Math.max(depthOf(top), ...below.map((n) => depthOf(n)));
  if (depthOf(target) + 1 + (deepest - depthOf(top)) > limits.maxDepth) {
    return "too-deep";
  }
  return null;
}
