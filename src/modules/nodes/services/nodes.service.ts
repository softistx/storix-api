import { ConflictError, tryObjectId } from "@softistx/mongo";
import { accountOf, type Who } from "@/core/members";
import { type Role, reaches, roleOn } from "@/modules/shares/public";
import type { NodeDoc, NodeState, NodesMongo } from "../models";
import {
  moveTooLarge,
  named,
  nodeNotFound,
  notAFolder,
  rootLocked,
  tooDeep,
} from "../nodes.errors";
import { MAX_DEPTH, MAX_MOVE_NODES, ROOT_NAME } from "../rules";
import { depthOf } from "../utils";

// The node with this id that the caller reaches with at least the role `need`
// (the effective role, plan §3.6: the owner of the tree, or a grant on the node
// or a folder above it, to the caller or one of their teams), or 404: a
// malformed id, an id of another workspace, a node the caller has no role on, a
// role below `need` and (unless `state` says otherwise) a trashed node are one
// answer. The grants of a trashed node have no effect: only its owner reaches it.
export async function nodeFor(
  mongo: NodesMongo,
  id: string,
  who: Who,
  need: Role,
  state: NodeState = "live",
): Promise<NodeDoc> {
  const objectId = tryObjectId(id);
  const node =
    objectId &&
    (await mongo.db.nodes.findFirst({
      _id: objectId,
      ...(state === "live" && { trashedAt: null }),
      ...(state === "trashed" && { trashedAt: { $ne: null } }),
    }));
  if (!node) throw nodeNotFound();
  const role =
    node.trashedAt && node.ownerId !== accountOf(who)
      ? null
      : await roleOn(mongo, who, node);
  if (!reaches(role, need)) throw nodeNotFound();
  return node;
}

// As `nodeFor`, and a folder: `not-a-folder` otherwise.
export async function folderFor(
  mongo: NodesMongo,
  id: string,
  who: Who,
  need: Role,
): Promise<NodeDoc> {
  const node = await nodeFor(mongo, id, who, need);
  if (node.type !== "FOLDER") throw notAFolder();
  return node;
}

// The node with this id that the account owns, or 404 (what only an owner does:
// the trash's own operations).
export const ownedNode = (
  mongo: NodesMongo,
  id: string,
  who: Who,
  state: NodeState = "live",
): Promise<NodeDoc> => nodeFor(mongo, id, who, "OWNER", state);

// As `ownedNode`, and a folder: `not-a-folder` otherwise.
export const ownedFolder = (
  mongo: NodesMongo,
  id: string,
  who: Who,
): Promise<NodeDoc> => folderFor(mongo, id, who, "OWNER");

// The account's root ("My files"), made on first need. It is made when the
// member joins (`nodesOnJoin`), and here for a member who joined before
// the module existed or whose clean-up failed. Two makers at once leave one:
// the unique index refuses the second, which reads the first's.
export async function ensureRoot(
  mongo: NodesMongo,
  accountId: string,
): Promise<NodeDoc> {
  const find = () =>
    mongo.db.nodes.findFirst({ ownerId: accountId, parentId: null });
  const existing = await find();
  if (existing) return existing;
  try {
    return await mongo.db.nodes.as(accountId).create({
      type: "FOLDER",
      name: ROOT_NAME,
      parentId: null,
      ancestors: [],
      ownerId: accountId,
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      const made = await find();
      if (made) return made;
    }
    throw error;
  }
}

// Serialises the writes that change the shape of an account's tree: every one
// raises its root's `treeRev` first, so two of them at once conflict and the
// later one runs again on what the earlier one left (a create under a folder
// that is being moved, two moves that would close a cycle). Call it first in
// the transaction.
export async function lockTree(tx: NodesMongo, accountId: string) {
  await tx.db.nodes.updateMany(
    { ownerId: accountId, parentId: null },
    { $inc: { treeRev: 1 } },
  );
}

// Serialises the writes under the trees these nodes sit in: every node's owner
// has their root raised, in a fixed order so two writers cannot wait on each
// other. A shared tree is locked as its owner's (the writer is not its owner).
export async function lockTreesOf(tx: NodesMongo, ids: readonly string[]) {
  const objectIds = ids.flatMap((id) => tryObjectId(id) ?? []);
  const found = await tx.db.nodes.findMany({
    filter: { _id: { $in: objectIds } },
  });
  const owners = new Set(found.flatMap((node) => node.ownerId ?? []));
  for (const owner of [...owners].sort()) await lockTree(tx, owner);
}

// Refuses a folder with more than `MAX_MOVE_NODES` nodes under it
// (`nodes.errors.move-too-large`): the size a move, a trash and a restore
// all keep within, so what is trashed can always be restored.
export async function assertMovable(tx: NodesMongo, folder: NodeDoc) {
  const below = await tx.db.nodes.count({ ancestors: folder._id });
  if (below > MAX_MOVE_NODES) throw moveTooLarge();
}

// A new folder under `parentId`, in the caller's tree.
export async function createFolder(
  mongo: NodesMongo,
  input: { parentId: string; name: string; accountId: Who },
): Promise<NodeDoc> {
  await ensureRoot(mongo, accountOf(input.accountId));
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTreesOf(tx, [input.parentId]);
      const parent = await folderFor(
        tx,
        input.parentId,
        input.accountId,
        "EDITOR",
      );
      if (depthOf(parent) + 1 > MAX_DEPTH) throw tooDeep();
      return tx.db.nodes.as(accountOf(input.accountId)).create({
        type: "FOLDER",
        name: input.name,
        parentId: parent._id,
        ancestors: [...parent.ancestors, parent._id],
        ownerId: parent.ownerId,
      });
    }),
  );
}

// Renames a node, if it is still at the version the caller read: `conflict`
// otherwise (a rename or a move came first). A root keeps its name. Answers
// the node as renamed and as it was.
export async function renameNode(
  mongo: NodesMongo,
  input: { id: string; name: string; version: number; accountId: Who },
) {
  const before = await nodeFor(mongo, input.id, input.accountId, "EDITOR");
  if (before.parentId === null) throw rootLocked();
  const node = await named(() =>
    mongo.db.nodes
      .as(accountOf(input.accountId))
      .update(before._id, { name: input.name, version: input.version }),
  );
  return { node, before };
}
