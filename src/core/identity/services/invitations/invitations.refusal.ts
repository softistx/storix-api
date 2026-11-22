import type { GraphQLError } from "graphql";
import { fail, forbidden, invalidInput, unauthenticated } from "@/i18n/fail";
import { tooShort, unavailable } from "../janus/janus.errors";

// janus-graphql's refusals as the API answers them: the code says what the
// client can act on. janus refuses every unusable code as INVITATION_INVALID
// and names why in `extensions.reason` (`unknown`, `expired`, `accepted`,
// `revoked`): `invitationRefusal` maps it with `INVITATION_REASONS`.
const INVITATION_REASONS = {
  expired: "invitations.errors.expired",
  accepted: "invitations.errors.already-accepted",
  revoked: "invitations.errors.revoked",
} as const;

export function invitationRefusal(error: GraphQLError): GraphQLError {
  const code = error.extensions["code"];
  const field = error.extensions["field"];
  const reason = error.extensions["reason"];
  const refused =
    reason === "expired" || reason === "accepted" || reason === "revoked"
      ? INVITATION_REASONS[reason]
      : undefined;
  // `unknown`, or a field other than the code, is the plain refusal below.
  if (code === "INVITATION_INVALID" && refused) {
    return fail(refused, { status: 400 });
  }
  switch (code) {
    case "UNAUTHENTICATED":
      return unauthenticated();
    case "FORBIDDEN":
    case "USER_INACTIVE":
      return forbidden();
    case "NOT_FOUND":
      return fail("invitations.errors.not-found", { status: 404 });
    case "INVITATION_INVALID":
    case "BAD_USER_INPUT":
    case "USER_INVALID":
      return typeof field === "string" && field !== "code"
        ? invalidInput([{ path: field, code: "validation.errors.invalid" }])
        : fail("invitations.errors.invalid", { status: 400 });
    case "INVITATION_LIMIT":
      return fail("invitations.errors.limit", { status: 409 });
    case "INVITATION_NOT_PENDING":
      return fail("invitations.errors.not-pending", { status: 409 });
    case "INVITATION_REFUSED":
      return forbidden();
    case "PASSWORD_REQUIRED":
      return fail("invitations.errors.password-required", {
        status: 400,
        field: "password",
      });
    case "PASSWORD_TOO_SHORT":
      return tooShort(
        typeof error.extensions["minLength"] === "number"
          ? error.extensions["minLength"]
          : 8,
      );
    case "SERVICE_UNAVAILABLE":
      return unavailable();
    default:
      return error;
  }
}
