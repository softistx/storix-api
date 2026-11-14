import { defineMiddleware } from "@alxia/core";
import { fail } from "../i18n/fail";
import { refusalError } from "./refusal";

// The paths a personal API key may call. Any other path refuses a key.
const keyPaths = ["/graphql", "/media", "/health", "/ready"] as const;

const acceptsKeys = (pathname: string) =>
  keyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

// A request authenticated by an API key (the viewer middleware reads a
// key-shaped bearer as one) on a path that does not accept keys is refused 401
// `auth.errors.api-key-not-accepted` before the route runs: a key is for the
// API, never for the UI's own routes.
export const keyPathsOnly = defineMiddleware<{
  viewer: { apiKeyId: string | null } | null;
}>()(async ({ url, viewer }, next) => {
  if (viewer?.apiKeyId && !acceptsKeys(url.pathname)) {
    throw refusalError(
      fail("auth.errors.api-key-not-accepted", { status: 401 }),
    );
  }
  return next();
});
