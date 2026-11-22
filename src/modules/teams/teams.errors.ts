import { ConflictError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";

// The module's refusals (the codes are listed in src/i18n/codes.ts).
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
