import { fail } from "@/i18n/fail";

// The module's refusals (the codes are listed in src/i18n/codes.ts).
export const memberNotFound = () =>
  fail("members.errors.not-found", { status: 404 });
export const lastOwner = () =>
  fail("workspaces.errors.last-owner", { status: 409 });
