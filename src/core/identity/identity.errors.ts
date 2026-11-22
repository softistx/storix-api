import { defineCodes } from "@softistx/alxia-i18n";

// The account flows (src/core/identity). A refusal says what the client can
// act on, never which of janus's reasons it was: an unknown address, a
// deactivated account and a wrong password are one `invalid-credentials`.
export const identity = defineCodes("identity", [
  "invalid-credentials",
  "email-unverified",
  "token-invalid",
  "second-factor-invalid",
  "second-factor-state",
  "unavailable",
  // 400: the current password of a password change is wrong (not a 401: the
  // caller is signed in).
  "current-password-wrong",
  // 404: no session of the caller's account has this id (another account's,
  // unknown or already ended, all alike).
  "session-not-found",
]);
