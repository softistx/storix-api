import type { CollectionsOf, ModuleHandle } from "@softistx/alxia-modules";
import type { Mongo } from "@softistx/mongo";

// The module's handle on a workspace's database: its own collection only.
export type SharesMongo = ModuleHandle<
  "shares",
  Mongo<{ collections: CollectionsOf }>
>;

export type GrantDoc = Awaited<
  ReturnType<SharesMongo["db"]["grants"]["getById"]>
>;

// The one place a workspace database becomes the `shares` module's typed
// handle (a scope's `mongo` and a transaction of another module's handle are
// plain records to the compiler: src/core/access/ports.ts).
export const sharesMongo = (database: unknown): SharesMongo =>
  database as SharesMongo;
