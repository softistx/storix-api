import { fail } from "@/i18n/fail";

// The module's refusals (the codes are listed in src/i18n/codes.ts).
export const slugTaken = () =>
  fail("workspaces.errors.slug-taken", { status: 409, field: "slug" });

export const notFound = () =>
  fail("workspaces.errors.not-found", { status: 404 });
