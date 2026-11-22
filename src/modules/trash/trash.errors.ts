import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// The trash (src/modules/trash).
export const trash = defineCodes("trash", [
  // 409: the node is not in the trash (restore and purge take what was trashed).
  "not-trashed",
]);

// The module's refusals (the codes above).
export const notTrashed = () =>
  fail("trash.errors.not-trashed", { status: 409 });
