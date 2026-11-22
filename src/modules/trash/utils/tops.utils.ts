import type { NodeDoc } from "@/modules/nodes/public";

// The entries of a selection that no other selected entry contains.
export function topsOf(selected: readonly NodeDoc[]): NodeDoc[] {
  const chosen = new Set(selected.map((node) => node.id));
  return selected.filter(
    (node) => !node.ancestors.some((a) => chosen.has(a.toHexString())),
  );
}
