import type { Plugin } from "graphql-yoga";

// A Yoga plugin (src/app.ts): every GraphQL response carries
// `Cache-Control: no-store`. The answers hold a session token and account data;
// janus's guide asks that they are never cached by a browser or a proxy.
// Since @alxia/core 0.16 a body declared over the limit gets core's 413 before Yoga
// runs, without this header: that answer holds nothing to cache.
export const noStore: Plugin = {
  onResponse({ response }) {
    response.headers.set("cache-control", "no-store");
  },
};
