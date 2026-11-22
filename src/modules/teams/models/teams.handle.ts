import type { CollectionsOf, ModuleHandle } from "@softistx/alxia-modules";
import type { Mongo } from "@softistx/mongo";

// The module's handle on a workspace's database: its own collection only.
export type TeamsMongo = ModuleHandle<
  "teams",
  Mongo<{ collections: CollectionsOf }>
>;

export type TeamDoc = Awaited<ReturnType<TeamsMongo["db"]["teams"]["getById"]>>;

// The one place a workspace database becomes the `teams` module's typed
// handle: the scope's `mongo` is a plain record to the compiler
// (src/core/access/ports.ts), so every reader goes through this function
// instead of casting.
export const teamsMongo = (database: unknown): TeamsMongo =>
  database as TeamsMongo;
