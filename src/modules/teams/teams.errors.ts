import { defineCodes } from "@softistx/alxia-i18n";
import { ConflictError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";

// The teams of a workspace (src/modules/teams).
export const teams = defineCodes("teams", [
  // 404: no team with this id in the workspace (a team of another workspace
  // is the same answer).
  "not-found",
  // 409: another team of the workspace has this name, in any case (field
  // `name`).
  "name-taken",
  // 400: an id is not a current member of the workspace (field `memberIds`).
  "member-unknown",
]);

// The module's refusals (the codes above).
export const teamNotFound = () =>
  fail("teams.errors.not-found", { status: 404 });
export const nameTaken = () =>
  fail("teams.errors.name-taken", { status: 409, field: "name" });
export const memberUnknown = () =>
  fail("teams.errors.member-unknown", { status: 400, field: "memberIds" });

// Runs a write that may break the unique name index (`name-taken`).
export async function named<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ConflictError) throw nameTaken();
    throw error;
  }
}
