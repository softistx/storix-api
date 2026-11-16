import type { FilesMongo } from "./files.service";

// The one place a workspace database becomes the `files` module's typed
// handle: the scope's `mongo`, the store's `databaseOf` and a job's database
// are plain records to the compiler (src/core/access/ports.ts), so every
// reader goes through this function instead of casting.
export const filesMongo = (database: unknown): FilesMongo =>
  database as FilesMongo;
