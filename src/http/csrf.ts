import { definePlugin } from "@softistx/graxia";
import { fail } from "../i18n/fail";

// The header every /graphql request carries, any non-empty value (the
// client's name: "storix-ui", "apollo-sandbox"…). A browser sends a custom
// header only after a CORS preflight, which a page of another origin does not
// pass, and a form or a plain <img> GET cannot send one: no cross-site
// request reaches a resolver, cookie or not.
export const clientHeader = "x-storix-client";

// A graxia plugin (src/app.ts): a request without the header is refused before
// it is parsed, 403. graxia's own CSRF check (on by default) covers the
// requests a browser does not preflight; this one checks every operation. It
// runs in `onParams`, so the IDE's page (a GET with no operation) still loads.
// The refusal is `auth.errors.client-header-required`.
export const requireClientHeader = definePlugin({
  name: "storix-client-header",
  onParams: ({ request, respond }) => {
    if (request.headers.get(clientHeader)?.trim()) return;
    const error = fail("auth.errors.client-header-required", { status: 403 });
    const { http: _http, ...extensions } = error.extensions;
    respond(
      Response.json(
        { errors: [{ message: error.message, extensions }] },
        { status: 403 },
      ),
    );
  },
});
