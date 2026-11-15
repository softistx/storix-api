import { fail } from "@/i18n/fail";

export const slugTaken = () =>
  fail("workspaces.errors.slug-taken", { status: 409, field: "slug" });
