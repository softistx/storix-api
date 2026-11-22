import type { Context } from "@/http/context";
import { apiKeyNotAccepted, unauthenticated } from "@/i18n/fail";
import type { Principal } from "../identity.port";

// An operation of the account (sign-in, a second factor, a password reset…) is
// never called with a personal API key: a key is for the API's data, so a
// stolen one cannot change who the account is. 401
// `auth.errors.api-key-not-accepted`.
export function refuseKey(ctx: Context) {
  if (typeof ctx.viewer?.apiKeyId === "string") {
    throw apiKeyNotAccepted();
  }
}

// The caller, or the 401 of an anonymous request.
export function requireViewer(ctx: Context): Principal {
  if (!ctx.viewer) throw unauthenticated();
  return ctx.viewer;
}

// The signed-in person behind a session (not a key) for the operations of the
// account itself.
export function requireSession(ctx: Context): Principal {
  refuseKey(ctx);
  return requireViewer(ctx);
}
