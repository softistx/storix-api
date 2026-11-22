import { fail } from "@/i18n/fail";

// The module's refusals (the codes are listed in src/i18n/codes.ts).
export const notTrashed = () =>
  fail("trash.errors.not-trashed", { status: 409 });
