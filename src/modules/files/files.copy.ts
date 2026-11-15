import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  cycle,
  depthOf,
  freeName,
  lockTree,
  type NodeDoc,
  named,
  ownedFolder,
  ownedNode,
  rootLocked,
  tooDeep,
} from "@/modules/nodes/public";
import { copyTooLarge } from "./files.errors";
import type { FilesMongo } from "./files.service";

// The most nodes one copy makes: a copied folder and everything under it.
export const MAX_COPY_NODES = 5_000;
const MAX_DEPTH = 16;

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
                limit: MAX_COPY_NODES + 1,
              })
            : [];
        made += 1 + below.length;
        if (made > MAX_COPY_NODES) throw copyTooLarge();
        const deepest = Math.max(
          depthOf(top),
          ...below.map((node) => depthOf(node)),
        );
        if (depthOf(target) + 1 + (deepest - depthOf(top)) > MAX_DEPTH) {
          throw tooDeep();
        }
        const name = await freeName(tx, target, top.name);
        const copy = await makeCopy(tx, top, name, target, input.accountId);
        const made2 = new Map([[top.id, copy]]);
        for (const node of below.toSorted(
          (a, b) => a.ancestors.length - b.ancestors.length,
        )) {
          const parent = made2.get(node.parentId?.toHexString() ?? "");
          if (!parent) continue;
          made2.set(
            node.id,
            await makeCopy(tx, node, node.name, parent, input.accountId),
          );
        }
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
    }),
  });
}
