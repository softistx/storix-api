import { refusalMapper } from "@alxia/access";
import { fail, forbidden, unauthenticated } from "@/i18n/fail";

// The refusals of `@alxia/access` and `@alxia/tenancy`, worded as the API's own
// codes. An unknown workspace, an inactive one and one the caller is not a
// member of are the same 404, so a caller learns nothing about which exist.
export const apiRefusal = refusalMapper((refusal) => {
  // The codes of `@alxia/tenancy` are matched by their prefix and name: they
  // are that package's, not entries of this API's inventory.
  if (refusal.code.startsWith("tenancy.errors.")) {
    switch (refusal.code.slice("tenancy.errors.".length)) {
      case "organization-required":
        return fail("workspaces.errors.workspace-required", { status: 400 });
      case "unknown-organization":
        return fail("workspaces.errors.not-found", { status: 404 });
      case "slug-taken":
        return fail("workspaces.errors.slug-taken", { status: 409 });
    }
  }
  switch (refusal.code) {
    case "auth.errors.unauthenticated":
      return unauthenticated();
    case "auth.errors.forbidden":
      return forbidden();
    default:
      return new Error(`unmapped refusal ${refusal.code}`);
  }
});
