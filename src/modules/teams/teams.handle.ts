import type { TeamsMongo } from "./teams.service";

// The one place a workspace database becomes the `teams` module's typed
// handle: the scope's `mongo` is a plain record to the compiler
// (src/core/access/ports.ts), so every reader goes through this function
// instead of casting.
export const teamsMongo = (database: unknown): TeamsMongo =>
  database as TeamsMongo;
