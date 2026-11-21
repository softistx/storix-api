import { defineMiddleware } from "@softistx/alxia";
import { API_KEY_PREFIX } from "../core/identity";
import { fail } from "../i18n/fail";
import { refusalError } from "./refusal";

// The paths a personal API key may call. Any other path refuses a key.
const keyPaths = ["/graphql", "/media", "/health", "/ready"] as const;

const acceptsKeys = (pathname: string) =>
  keyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

// Whether the request carries a bearer shaped like a personal API key.
const keyShaped = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return /^bearer\s+/i.test(header)
    ? header
        .replace(/^bearer\s+/i, "")
        .trim()
        .startsWith(API_KEY_PREFIX)
    : false;
};

// A key is for the API, never for the UI's own routes: a request on a path that
// does not accept keys is refused 401 `auth.errors.api-key-not-accepted`
// before the route runs, when it carries a key-shaped bearer, whether or not
// the key is valid (a revoked or unknown key is refused the same way, so a
// leaked key's state is not probed there).
export const keyPathsOnly = defineMiddleware<{
  viewer: { apiKeyId: string | null } | null;
}>()(async ({ url, request, viewer }, next) => {
  if (!acceptsKeys(url.pathname) && (viewer?.apiKeyId || keyShaped(request))) {
    throw refusalError(
      fail("auth.errors.api-key-not-accepted", { status: 401 }),
    );
  }
  return next();
});
