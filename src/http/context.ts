import { alxia, defineMiddleware } from "@alxia/core";
import type { GraphQLContext } from "@alxia/graphql";
import { env } from "../config/env";
import { clientIp } from "./client-ip";

// The base: what every resolver reads, decorated or derived here: `env` and
// `requestId`. E1 adds the request's language (A1) and the viewer.
export function createBase() {
  // `requestId` names the request in logs and audit trails. alxia exposes none,
  // so the base makes one: always generated here, never read from
  // `X-Request-Id`, which any client could forge. It is echoed as the
  // `X-Request-Id` response header, so a user can quote it.
  const requestIdOf = defineMiddleware(({ set }, next) => {
    const requestId: string = crypto.randomUUID();
    set.headers.set("x-request-id", requestId);
    return next({ requestId });
  });

  // The client address (`ip`) is the connection's, or, behind the proxies of
  // TRUSTED_PROXIES, the one they appended to X-Forwarded-For. When
  // API_PROXY_SECRET is set, only a request that carries it (the UI's server)
  // gets the forwarded address honoured (`clientIp`). `requireProxySecret` is
  // not wired: /graphql and /media are also reached by API keys, so no path is
  // BFF-only (docs/development.md, "The proxy secret").
  const base = env.TRUSTED_PROXIES
    ? alxia({
        ip: clientIp({
          trusted: env.TRUSTED_PROXIES,
          secret: env.API_PROXY_SECRET,
        }),
      })
    : alxia();
  return base.decorate({ env }).use(requestIdOf);
}

export type Base = ReturnType<typeof createBase>;

// A resolver's context: Yoga's and the base's, plus what src/app.ts's
// `context` option adds per request. The generated `Resolvers` takes it
// (codegen.ts: `contextType`).
export type Context = Readonly<GraphQLContext<Base, Record<never, never>>>;
