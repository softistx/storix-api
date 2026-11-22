import { defineCodes } from "@softistx/alxia-i18n";
import { ConflictError, OptimisticLockError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";

// The tree of folders (src/modules/nodes).
export const nodes = defineCodes("nodes", [
  // 404: no node with this id in the caller's tree (an unknown id, another
  // workspace's and another member's node are one answer).
  "not-found",
  // 409: a sibling already has this name, in any case (field `name`).
  "name-taken",
  // 409: the folder would sit deeper than 16 levels.
  "too-deep",
  // 409: a folder moved into itself or its own subtree.
  "cycle",
  // 409: the node changed since the version the caller read.
  "conflict",
  // 400: the parent is not a folder (field `parentId`).
  "not-a-folder",
  // 409: the subtree has more than 5,000 nodes.
  "move-too-large",
  // 409: a root is never renamed nor moved.
  "root-locked",
]);

// The module's refusals (the codes above).
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
