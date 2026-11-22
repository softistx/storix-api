import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// The memberships of a workspace (src/core/members).
export const members = defineCodes("members", ["not-found"]);

// The module's refusals (the codes above).
export const memberNotFound = () =>
  fail("members.errors.not-found", { status: 404 });
export const lastOwner = () =>
  fail("workspaces.errors.last-owner", { status: 409 });
