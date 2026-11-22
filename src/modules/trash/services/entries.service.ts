import type { WorkspacesMongo } from "@/core/workspaces";
import { accounted, type FilesMongo } from "@/modules/files/public";
import {
  freeName,
  moveOne,
  type NodeDoc,
  type NodesMongo,
  nodeNotFound,
  ownedNode,
} from "@/modules/nodes/public";
import { notTrashed } from "../trash.errors";
import { inSession } from "../utils";

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

// The nodes as they are now, read again inside the transaction; one that is
// gone is left out.
export async function rereadNodes(tx: FilesMongo, nodes: readonly NodeDoc[]) {
  const found: NodeDoc[] = [];
  for (const node of nodes) {
    const fresh = await tx.db.nodes.findFirst({ _id: node._id });
    if (fresh) found.push(fresh);
  }
  return found;
}

// Stamps one top node and everything live under it as trashed: the top gets
// `trashedAt` and `trashedBy` and is the trash's entry, the rest the same
// stamp and `trashRootId` = the top. The bytes they held become the trash's
// (`accounted`).
export async function trashTop(
  tx: FilesMongo,
  core: WorkspacesMongo,
  input: { workspaceId: string; accountId: string },
  top: NodeDoc,
  at: Date,
): Promise<void> {
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

// Brings one trashed entry back with its subtree: to its folder when that is
// live, else to `root`; a name a live sibling holds there becomes `name (1)`.
// Answers the node as restored.
export async function restoreEntry(
  tx: FilesMongo,
  core: WorkspacesMongo,
  input: { workspaceId: string; accountId: string },
  nodes: NodesMongo,
  node: NodeDoc,
  root: NodeDoc,
): Promise<NodeDoc> {
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
        { $set: { trashedAt: null, trashedBy: null, trashRootId: null } },
        inSession(tx),
      );
    },
    () => files,
  );
  const back = await tx.db.nodes.findFirst({ _id: node._id });
  if (!back) throw nodeNotFound();
  return back;
}
