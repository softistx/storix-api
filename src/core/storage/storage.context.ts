import type { Context } from "@/http/context";

// What the media kinds read from the request: the viewer and the guard's
// input and the tenancy (the core database holds the quota), added by the base's middlewares (src/http/context.ts). `/media` is
// mounted after them.
export type MediaRequires = Pick<
  Context,
  "viewer" | "guard" | "ip" | "tenancy"
>;
