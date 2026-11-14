import type { Plugin } from "graphql-yoga";
import { fail } from "../i18n/fail";

// The header every /graphql request carries, any non-empty value (the
// client's name: "storix-ui", "apollo-sandbox"…). A browser sends a custom
// header only after a CORS preflight, which a page of another origin does not
// pass, and a form or a plain <img> GET cannot send one: no cross-site
// request reaches a resolver, cookie or not.
export const clientHeader = "x-storix-client";

// A Yoga plugin (src/app.ts): a request without the header is refused before
// it is parsed, 403. Yoga's `useCSRFPrevention` checks only the requests a
// browser does not preflight; this one checks every request. The refusal
// is `auth.errors.client-header-required`.
export const requireClientHeader: Plugin = {
  onRequestParse({ request }) {
    if (request.headers.get(clientHeader)?.trim()) return;
    throw fail("auth.errors.client-header-required", { status: 403 });
  },
};
