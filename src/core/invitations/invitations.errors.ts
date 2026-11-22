import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// The invitations to a workspace (src/core/invitations). The code of an
// invitation that is unknown or malformed is `invalid`; one that names a real
// invitation says why it cannot be used: `expired`, `already-accepted` or
// `revoked` (the code is the invitee's secret, so it tells nothing to others).
export const invitations = defineCodes("invitations", [
  // 404: no invitation with this id in the workspace (or the caller may not
  // see it).
  "not-found",
  // 400: the code names no invitation (unknown or malformed), or one of a
  // workspace that is not open.
  "invalid",
  // 400: the invitation's 7 days have passed.
  "expired",
  // 400: the invitation was already accepted.
  "already-accepted",
  // 400: the invitation was withdrawn (revoked) by an admin.
  "revoked",
  // 409: the invitation was accepted or revoked, so it cannot be sent again or
  // revoked.
  "not-pending",
  // 409: the workspace already has the most pending invitations it may have.
  "limit",
  // 409: the address already belongs to a member of the workspace.
  "already-member",
  // 400: the invitee has no account yet and gave no password (field
  // `password`).
  "password-required",
]);

// The module's refusals (the codes above).
export const invalidInvitation = () =>
  fail("invitations.errors.invalid", { status: 400 });
export const alreadyMember = () =>
  fail("invitations.errors.already-member", { status: 409, field: "email" });
