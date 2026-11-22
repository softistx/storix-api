import { ConflictError, OptimisticLockError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";

// The module's refusals (the codes are listed in src/i18n/codes.ts).
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
