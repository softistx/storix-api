import type { CollectionsOf, ModuleHandle } from "@softistx/alxia-modules";
import {
  ConflictError,
  type Mongo,
  OptimisticLockError,
  tryObjectId,
} from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import { NAME_COLLATION } from "./nodes.collection";
import { MAX_DEPTH, MAX_MOVE_NODES, ROOT_NAME } from "./nodes.rules";

// The module's handle on a workspace's database: its own collection only.
export type NodesMongo = ModuleHandle<
  "nodes",
  Mongo<{ collections: CollectionsOf }>
>;

export type NodeDoc = Awaited<ReturnType<NodesMongo["db"]["nodes"]["getById"]>>;

export const nodeNotFound = () =>
  fail("nodes.errors.not-found", { status: 404 });
export const nameTaken = () =>
  fail("nodes.errors.name-taken", { status: 409, field: "name" });
export const tooDeep = () => fail("nodes.errors.too-deep", { status: 409 });
export const cycle = () => fail("nodes.errors.cycle", { status: 409 });
export const conflict = () => fail("nodes.errors.conflict", { status: 409 });
export const notAFolder = () =>
  fail("nodes.errors.not-a-folder", { status: 400, field: "parentId" });
export const moveTooLarge = () =>
  fail("nodes.errors.move-too-large", { status: 409 });
export const rootLocked = () =>
  fail("nodes.errors.root-locked", { status: 409 });

// Runs a write that may break the unique name index (`name-taken`) or a
// version that moved on (`conflict`).
export async function named<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ConflictError) throw nameTaken();
    if (error instanceof OptimisticLockError) throw conflict();
    throw error;
  }
}

// Which nodes of a tree a lookup sees: the live ones (the default: a trashed
// node is gone for every read and write), the trashed ones (the trash's own
// operations) or both.
export type NodeState = "live" | "trashed" | "any";

// The node with this id that the account owns, or 404: a malformed id, an id
// of another workspace, the node of another member and (unless `state` says
// otherwise) a trashed node are one answer. Nothing is shared yet (the shares
// module widens this one function).
export async function ownedNode(
  mongo: NodesMongo,
  id: string,
  accountId: string,
  state: NodeState = "live",
): Promise<NodeDoc> {
  const objectId = tryObjectId(id);
  const node =
    objectId &&
    (await mongo.db.nodes.findFirst({
      _id: objectId,
      ownerId: accountId,
      ...(state === "live" && { trashedAt: null }),
      ...(state === "trashed" && { trashedAt: { $ne: null } }),
    }));
  if (!node) throw nodeNotFound();
  return node;
}

// As `ownedNode`, and a folder: `not-a-folder` otherwise.
export async function ownedFolder(
  mongo: NodesMongo,
  id: string,
  accountId: string,
): Promise<NodeDoc> {
  const node = await ownedNode(mongo, id, accountId);
  if (node.type !== "FOLDER") throw notAFolder();
  return node;
}

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

// Refuses a folder with more than `MAX_MOVE_NODES` nodes under it
// (`nodes.errors.move-too-large`): the size a move, a trash and a restore
// all keep within, so what is trashed can always be restored.
export async function assertMovable(tx: NodesMongo, folder: NodeDoc) {
  const below = await tx.db.nodes.count({ ancestors: folder._id });
  if (below > MAX_MOVE_NODES) throw moveTooLarge();
}

export const depthOf = (node: NodeDoc) => node.ancestors.length + 1;

// A new folder under `parentId`, in the caller's tree.
export async function createFolder(
  mongo: NodesMongo,
  input: { parentId: string; name: string; accountId: string },
): Promise<NodeDoc> {
  await ensureRoot(mongo, input.accountId);
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTree(tx, input.accountId);
      const parent = await ownedFolder(tx, input.parentId, input.accountId);
      if (depthOf(parent) + 1 > MAX_DEPTH) throw tooDeep();
      return tx.db.nodes.as(input.accountId).create({
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
  input: { id: string; name: string; version: number; accountId: string },
) {
  const before = await ownedNode(mongo, input.id, input.accountId);
  if (before.parentId === null) throw rootLocked();
  const node = await named(() =>
    mongo.db.nodes
      .as(input.accountId)
      .update(before._id, { name: input.name, version: input.version }),
  );
  return { node, before };
}

export const byName = { sort: { name: 1 }, collation: NAME_COLLATION } as const;
