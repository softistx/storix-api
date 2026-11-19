import type { MembersMongo } from "./members.service";

// The one place the core database becomes the `members` module's typed
// handle: `ctx.tenancy.core`, a scope's `core` and a store's `core` are plain
// records to the compiler (src/core/access/ports.ts), so every reader goes
// through this function instead of casting.
export const membersMongo = (core: unknown): MembersMongo =>
  core as MembersMongo;
