import { defineCodes } from "@softistx/alxia-i18n";
import { ConflictError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";

// The grants of a workspace's nodes (src/modules/shares).
export const shares = defineCodes("shares", [
  // 404: no node with this id that the caller may read, or no grant with this
  // id on it (an unknown id, another workspace's node, a stranger's and a
  // trashed node are one answer).
  "not-found",
  // 400: the principal is not a current member of the workspace, or not a team
  // of it (field `principal`).
  "principal-unknown",
  // 409: the node already has a grant for this member or team (field
  // `principal`): change it instead.
  "already-shared",
  // 403: the caller reads the node but may not share it: only its owner and
  // its editors do.
  "owner-only",
]);

// The module's refusals (the codes above).
export const shareNotFound = () =>
  fail("shares.errors.not-found", { status: 404 });
export const principalUnknown = () =>
  fail("shares.errors.principal-unknown", {
    status: 400,
    field: "principal",
  });
export const alreadyShared = () =>
  fail("shares.errors.already-shared", { status: 409, field: "principal" });
export const ownerOnly = () =>
  fail("shares.errors.owner-only", { status: 403 });

// Runs a write that may break the unique (node, principal) index
// (`already-shared`).
export async function shared<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ConflictError) throw alreadyShared();
    throw error;
  }
}
