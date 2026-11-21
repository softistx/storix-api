import { forwardedIp, type TrustedProxies } from "@softistx/alxia";

export const PROXY_SECRET_HEADER = "x-storix-proxy-secret";

// The widget's endpoint: called by browsers through the deploy stack, never by the UI's
// server, so it cannot carry the secret.
const OPEN_PREFIX = "/public/";

// The `ip` option behind proxies, passed straight to `alxia({ ip })`: it must
// not be wrapped, or @softistx/alxia-proxy no longer strips the secret header. Under
// /public/, TRUSTED_PROXIES alone. Elsewhere (/graphql, the media routes), with
// `secret` (API_PROXY_SECRET), the forwarded address is honoured only on a
// request that carries it in `x-storix-proxy-secret`; any other request is the
// connection's address. Without `secret`, TRUSTED_PROXIES alone everywhere.
export function clientIp(options: {
  trusted: TrustedProxies;
  secret?: string | undefined;
}) {
  return forwardedIp({
    trusted: options.trusted,
    ...(options.secret
      ? {
          secret: {
            header: PROXY_SECRET_HEADER,
            value: options.secret,
            appliesTo: (url: URL) => !url.pathname.startsWith(OPEN_PREFIX),
          },
        }
      : {}),
  });
}
