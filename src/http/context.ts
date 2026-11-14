import { alxia, defineMiddleware } from "@alxia/core";
import type { GraphQLContext } from "@alxia/graphql";
import { lazyScope } from "@alxia/tenancy";
import { GraphQLError } from "graphql";
import { access } from "../config/access";
import { env } from "../config/env";
import { tenancy } from "../config/tenancy";
import type { Identity, Principal } from "../core/identity";
import { i18n } from "../i18n";
import { clientIp } from "./client-ip";
import type { Limits } from "./rate-limits";
import { refusalError } from "./refusal";

// The base: what every resolver reads, decorated or derived here: `env` and
// `requestId`, the request's language (`language`, `t`: src/i18n), the
// `identity` port, the per-address `limits`, the workspaces' `tenancy` and
// `access` catalogue, the request's `viewer` (a Principal or null) and its `guard`.
export function createBase(identity: Identity, limits: Limits) {
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
  // The viewer: who the request is from, or null. `apiKey: true` lets a
  // key-shaped bearer authenticate as its owner; src/http/key-paths.ts refuses
  // one off the paths that accept keys. A store that cannot answer is 503
  // (`identity.errors.unavailable`), never an anonymous request.
  const viewerOf = defineMiddleware(async ({ request }, next) => {
    let viewer: Principal | null;
    try {
      viewer = await identity.authenticate(request, { apiKey: true });
    } catch (error) {
      if (error instanceof GraphQLError) throw refusalError(error);
      throw error;
    }
    return next({ viewer });
  });
  // The guards' input (src/core/access): the viewer as `{ id }` (a personal
  // API key is none: it is never a member), the catalogue and the request's
  // workspace scope, resolved on first use and kept for the request.
  return base
    .decorate({ env, identity, limits, tenancy, access })
    .use(requestIdOf)
    .use(i18n)
    .use(viewerOf)
    .use(({ request, viewer }, next) => {
      const member =
        viewer && viewer.apiKeyId === null ? { id: viewer.accountId } : null;
      return next({
        guard: {
          viewer: member,
          access,
          scope: lazyScope(tenancy, request, member),
        },
      });
    });
}

export type Base = ReturnType<typeof createBase>;

// A resolver's context: Yoga's and the base's, plus what src/app.ts's
// `context` option adds per request. The generated `Resolvers` takes it
// (codegen.ts: `contextType`).
export type Context = Readonly<GraphQLContext<Base, Record<never, never>>>;
