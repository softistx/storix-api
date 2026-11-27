import { accountOf, type Who } from "@/core/members";
import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  cycle,
  folderFor,
  freeName,
  lockTreesOf,
  MAX_DEPTH,
  type NodeDoc,
  named,
  nodeFor,
  rootLocked,
  tooDeep,
} from "@/modules/nodes/public";
import { copyTooLarge } from "../files.errors";
import type { FilesMongo } from "../models";
import { type CopyLimits, copyBlocker, copyOverflow } from "../rules";

// The most nodes one copy makes: a copied folder and everything under it.
export const MAX_COPY_NODES = 5_000;

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
    accountId: Who;
    workspaceId: string;
  },
  limits: CopyLimits = LIMITS,
): Promise<{ node: NodeDoc; from: string }[]> {
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTreesOf(tx, [input.parentId, ...input.ids]);
      const target = await folderFor(
        tx,
        input.parentId,
        input.accountId,
        "EDITOR",
      );
      const tops = await selectTops(tx, input.ids, input.accountId);
      const refs = new Map<string, number>();
      const copies: { node: NodeDoc; from: string }[] = [];
      let made = 0;
      for (const top of tops) {
        const below = await checkedBelow(tx, { top, target, made, limits });
        made += 1 + below.length;
        const name = await freeName(tx, target, top.name);
        const copy = await copyTree(tx, {
          top,
          below,
          name,
          target,
          accountId: accountOf(input.accountId),
        });
        for (const node of [top, ...below]) {
          if (node.blobKey) {
            refs.set(node.blobKey, (refs.get(node.blobKey) ?? 0) + 1);
          }
        }
        copies.push({ node: copy, from: top.id });
      }
      await holdCopiedBlobs(tx, core, input.workspaceId, refs);
      return copies;
    }),
  );
}

// What a copy of `top` would add under `target`, checked before anything is
// written (the rules say what is refused). Answers the live nodes under `top`.
async function checkedBelow(
  tx: FilesMongo,
  input: { top: NodeDoc; target: NodeDoc; made: number; limits: CopyLimits },
): Promise<NodeDoc[]> {
  const { top, target, made, limits } = input;
  const blocker = copyBlocker(top, target);
  if (blocker === "root-locked") throw rootLocked();
  if (blocker === "cycle") throw cycle();
  const below =
    top.type === "FOLDER"
      ? await tx.db.nodes.findMany({
          filter: { ancestors: top._id, trashedAt: null },
          limit: limits.maxNodes + 1,
        })
      : [];
  const overflow = copyOverflow({ top, target, below, made, limits });
  if (overflow === "copy-too-large") throw copyTooLarge();
  if (overflow === "too-deep") throw tooDeep();
  return below;
}

// The copies share the blobs: each key is held once more per copy. The
// workspace holds no more bytes (a shared blob counts once) and as many more
// files as there are copies of files.
async function holdCopiedBlobs(
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

// The nodes a copy starts from: each selected node the caller may read, but
// not one under another selected one (it is copied with it).
async function selectTops(
  tx: FilesMongo,
  ids: readonly string[],
  accountId: Who,
): Promise<NodeDoc[]> {
  const selected: NodeDoc[] = [];
  for (const id of new Set(ids)) {
    selected.push(await nodeFor(tx, id, accountId, "VIEWER"));
  }
  const chosen = new Set(selected.map((node) => node.id));
  return selected.filter(
    (node) => !node.ancestors.some((a) => chosen.has(a.toHexString())),
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
      cropsStatus: node.cropsStatus,
      focalPoint: node.focalPoint,
      cropsKey: node.cropsKey,
      ...((node.status === "PROCESSING" ||
        node.cropsStatus === "PROCESSING") && {
        renditionsAt: node.renditionsAt ?? new Date(),
      }),
    }),
  });
}
