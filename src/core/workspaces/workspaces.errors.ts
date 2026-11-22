import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// The workspaces (src/core/workspaces). `not-found` is also the answer for a
// workspace the caller is not a member of, so none is told from an unknown one.
export const workspaces = defineCodes("workspaces", [
  "not-found",
  // 400: a workspace operation without the `x-storix-workspace` header.
  "workspace-required",
  "slug-taken",
  // 409: the change would leave the workspace without an owner.
  "last-owner",
]);

// The module's refusals (the codes above).
export const slugTaken = () =>
  fail("workspaces.errors.slug-taken", { status: 409, field: "slug" });

export const notFound = () =>
  fail("workspaces.errors.not-found", { status: 404 });
