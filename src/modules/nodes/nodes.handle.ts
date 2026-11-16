import type { NodesMongo } from "./nodes.service";

// The one place a workspace database becomes the `nodes` module's typed
// handle. The registry types the slot (`Register`), but a scope's `mongo`, the
// store's `databaseOf` and a transaction of another module's handle are plain
// records to the compiler (src/core/access/ports.ts says why), so every
// reader goes through this function instead of casting.
export const nodesMongo = (database: unknown): NodesMongo =>
  database as NodesMongo;
