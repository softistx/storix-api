import type { NodeDoc } from "../models";
import { NAME_COLLATION } from "../models";

// A folder's depth counts from its root, which is depth 1.
export const depthOf = (node: NodeDoc) => node.ancestors.length + 1;

// Listings by name, ignoring case.
export const byName = { sort: { name: 1 }, collation: NAME_COLLATION } as const;
