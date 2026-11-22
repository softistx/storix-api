import type { CollectionsOf, ModuleHandle } from "@softistx/alxia-modules";
import type { Mongo } from "@softistx/mongo";

// The module's handle on a workspace's database: its own collection only.
export type NodesMongo = ModuleHandle<
  "nodes",
  Mongo<{ collections: CollectionsOf }>
>;

export type NodeDoc = Awaited<ReturnType<NodesMongo["db"]["nodes"]["getById"]>>;

// Which nodes of a tree a lookup sees: the live ones (the default: a trashed
// node is gone for every read and write), the trashed ones (the trash's own
// operations) or both.
export type NodeState = "live" | "trashed" | "any";

// The one place a workspace database becomes the `nodes` module's typed
// handle. The registry types the slot (`Register`), but a scope's `mongo`, the
// store's `databaseOf` and a transaction of another module's handle are plain
// records to the compiler (src/core/access/ports.ts says why), so every
// reader goes through this function instead of casting.
export const nodesMongo = (database: unknown): NodesMongo =>
  database as NodesMongo;
