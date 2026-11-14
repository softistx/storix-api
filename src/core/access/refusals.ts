import { refusalMapper } from "@alxia/access";
import { fail, forbidden, unauthenticated } from "@/i18n/fail";

// The refusals of `@alxia/access` and `@alxia/tenancy`, worded as the API's own
// codes. An unknown workspace, an inactive one and one the caller is not a
// member of are the same 404, so a caller learns nothing about which exist.
export const apiRefusal = refusalMapper((refusal) => {
  switch (refusal.code) {
    case "auth.errors.unauthenticated":
      return unauthenticated();
    case "auth.errors.forbidden":
      return forbidden();
    case "tenancy.errors.organization-required":
      return fail("workspaces.errors.workspace-required", { status: 400 });
    case "tenancy.errors.unknown-organization":
      return fail("workspaces.errors.not-found", { status: 404 });
    case "tenancy.errors.slug-taken":
      return fail("workspaces.errors.slug-taken", { status: 409 });
    default:
      return new Error(`unmapped refusal ${refusal.code}`);
  }
});
