import { definePlugin } from "@softistx/graxia";

// A graxia plugin (src/app.ts): every GraphQL response carries
// `Cache-Control: no-store`. The answers hold a session token and account data;
// janus's guide asks that they are never cached by a browser or a proxy.
// Refusals carry it too (the 403 below, graxia's 4xx, the body limit's 413).
// It sits first in the list: `respond` skips the plugins after the one that
// answers, so a plugin placed before the refusing ones still sets its header.
export const noStore = definePlugin({
  name: "storix-no-store",
  onRequest: ({ responseHeaders }) => {
    responseHeaders.set("cache-control", "no-store");
  },
});
