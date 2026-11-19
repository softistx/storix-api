import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  cycle,
  depthOf,
  freeName,
  lockTree,
  MAX_DEPTH,
  type NodeDoc,
  named,
  ownedFolder,
  ownedNode,
  rootLocked,
  tooDeep,
} from "@/modules/nodes/public";
import { copyTooLarge } from "./files.errors";
import type { FilesMongo } from "./files.handle";

// The most nodes one copy makes: a copied folder and everything under it.
export const MAX_COPY_NODES = 5_000;

// The caps a copy keeps; a spec passes lower ones to reach them cheaply.
export interface CopyLimits {
  maxNodes: number;
  maxDepth: number;
}
const LIMITS: CopyLimits = { maxNodes: MAX_COPY_NODES, maxDepth: MAX_DEPTH };

// Copies nodes under a folder of the caller's tree, all or nothing. A copy of
// a file shares its blob (`blobs.refs` goes up, the bucket is not touched); a
// copy of a folder copies what is under it, tags and metadata included. A
// copy never clashes: a taken name becomes `name (1)`, `name (2)`… A selected
// node under another selected one is copied with it. Answers the copies made
// with the id each one was made from. `cycle` for a folder copied into its own
// subtree, `too-deep` past 16 levels, `copy-too-large` past 5,000 nodes,
// `root-locked` for a root.
export async function copyNodes(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: {
    ids: readonly string[];
    parentId: string;
    accountId: string;
    workspaceId: string;
  },
  limits: CopyLimits = LIMITS,
): Promise<{ node: NodeDoc; from: string }[]> {
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
      const refs = new Map<string, number>();
      const copies: { node: NodeDoc; from: string }[] = [];
      let made = 0;
      for (const top of tops) {
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
        made += 1 + below.length;
        if (made > limits.maxNodes) throw copyTooLarge();
        const deepest = Math.max(
          depthOf(top),
          ...below.map((node) => depthOf(node)),
        );
        if (depthOf(target) + 1 + (deepest - depthOf(top)) > limits.maxDepth) {
          throw tooDeep();
        }
        const name = await freeName(tx, target, top.name);
        const copy = await copyTree(tx, {
          top,
          below,
          name,
          target,
          accountId: input.accountId,
        });
        for (const node of [top, ...below]) {
          if (node.blobKey) {
            refs.set(node.blobKey, (refs.get(node.blobKey) ?? 0) + 1);
          }
        }
        copies.push({ node: copy, from: top.id });
      }
      // The copies share the blobs: each key is held once more per copy. The
      // workspace holds no more bytes (a shared blob counts once) and as many
      // more files as there are copies of files.
      let copiedFiles = 0;
      for (const [key, count] of refs) {
        await tx.db.blobs.updateMany({ key }, { $inc: { refs: count } });
        copiedFiles += count;
      }
      if (copiedFiles > 0) {
        await addUsage(core.withSession(tx.session), input.workspaceId, {
          bytes: 0,
          files: copiedFiles,
        });
      }
      return copies;
    }),
  );
}

// Copies a node and what is under it below `target`, shallowest first so a
// parent is made before its children; answers the copy of `top`. Only the top
// takes the free name: what is under it keeps its own (a new folder is empty).
async function copyTree(
  tx: FilesMongo,
  input: {
    top: NodeDoc;
    below: readonly NodeDoc[];
    name: string;
    target: NodeDoc;
    accountId: string;
  },
): Promise<NodeDoc> {
  const copy = await makeCopy(
    tx,
    input.top,
    input.name,
    input.target,
    input.accountId,
  );
  const copiedAs = new Map([[input.top.id, copy]]);
  const byDepth = input.below.toSorted(
    (a, b) => a.ancestors.length - b.ancestors.length,
  );
  for (const node of byDepth) {
    const parent = copiedAs.get(node.parentId?.toHexString() ?? "");
    if (!parent) continue;
    copiedAs.set(
      node.id,
      await makeCopy(tx, node, node.name, parent, input.accountId),
    );
  }
  return copy;
}

async function makeCopy(
  tx: FilesMongo,
  node: NodeDoc,
  name: string,
  parent: NodeDoc,
  accountId: string,
): Promise<NodeDoc> {
  return tx.db.nodes.as(accountId).create({
    type: node.type,
    name,
    parentId: parent._id,
    ancestors: [...parent.ancestors, parent._id],
    ownerId: parent.ownerId,
    ...(node.type === "FILE" && {
      blobKey: node.blobKey,
      mimeType: node.mimeType,
      size: node.size,
      family: node.family,
      tags: node.tags,
      meta: node.meta,
      status: node.status,
      focalPoint: node.focalPoint,
      ...(node.status === "PROCESSING" && {
        renditionsAt: node.renditionsAt ?? new Date(),
      }),
    }),
  });
}
