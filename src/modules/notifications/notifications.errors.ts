import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// The inbox and the mail preference of an account (src/modules/notifications).
export const notifications = defineCodes("notifications", [
  // 404: no notification with this id in the caller's inbox (an unknown id and
  // another account's are one answer).
  "not-found",
]);

export const notificationNotFound = () =>
  fail("notifications.errors.not-found", { status: 404 });
