import { coreMigrationsOf } from "@alxia/modules";
import { type Migration, migrationStatus } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { modules } from "../modules/registry";

// The core database's migrations, every module's in dependency order (the
// registry's `coreMigrations`). E1 adds the workspaces' own list.
export const migrations: readonly Migration[] = coreMigrationsOf(modules);

// The database is not at the migrations this build lists: some are pending
// (`bun run db:migrate` applies them) or recorded but unknown to this build
// (a newer build ran them: deploy that one).
export class MigrationsOutOfSyncError extends Error {
  constructor(
    readonly pending: readonly string[],
    readonly missing: readonly string[],
  ) {
    super(
      [
        pending.length > 0 &&
          `${pending.length} migration(s) pending: run bun run db:migrate`,
        missing.length > 0 &&
          `${missing.length} migration(s) recorded but not in this build: ${missing.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; "),
    );
    this.name = "MigrationsOutOfSyncError";
  }
}

// Refuses a database with a pending or an unknown migration: what the server
// checks before it listens, so no request runs on texts a migration has yet to
// write (or on a database a newer build has moved past).
export async function assertMigrated(
  db: Db,
  list: readonly Migration[] = migrations,
): Promise<void> {
  const status = await migrationStatus(db, list);
  const ids = (state: string) =>
    status.filter((entry) => entry.state === state).map((entry) => entry.id);
  const pending = ids("pending");
  const missing = ids("missing");
  if (pending.length > 0 || missing.length > 0) {
    throw new MigrationsOutOfSyncError(pending, missing);
  }
}
