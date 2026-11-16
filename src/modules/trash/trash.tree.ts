import { fail } from "@/i18n/fail";
import type { FilesMongo } from "@/modules/files/public";
import {
  type NodeDoc,
  type NodesMongo,
  nodeNotFound,
  ownedNode,
} from "@/modules/nodes/public";

export const notTrashed = () =>
  fail("trash.errors.not-trashed", { status: 409 });

// The transaction's session, for the driver calls that take it as an option.
export const inSession = (tx: FilesMongo) => {
  const session = tx.db.nodes.session;
  return session ? { session } : {};
};

// A top entry of the caller's trash: the node they trashed, not one that went
// with a folder. `not-trashed` for a live node, `not-found` for a node of the
// trash's subtrees (restore or purge the folder) and for what is not theirs.
export async function entryOf(
  nodes: NodesMongo,
  id: string,
  accountId: string,
): Promise<NodeDoc> {
  const node = await ownedNode(nodes, id, accountId, "any");
  if (!node.trashedAt) throw notTrashed();
  if (node.trashRootId) throw nodeNotFound();
  return node;
}

// The entries of a selection that no other selected entry contains.
export function topsOf(selected: readonly NodeDoc[]): NodeDoc[] {
  const chosen = new Set(selected.map((node) => node.id));
  return selected.filter(
    (node) => !node.ancestors.some((a) => chosen.has(a.toHexString())),
  );
}

// The keys of the blobs the nodes matching a filter hold.
export async function blobKeysOf(
  tx: FilesMongo,
  filter: Record<string, unknown>,
): Promise<string[]> {
  const keys: unknown[] = await tx.db.nodes.raw.distinct(
    "blobKey",
    { ...filter, blobKey: { $ne: null } },
    inSession(tx),
  );
  return keys.filter((key): key is string => typeof key === "string");
}
