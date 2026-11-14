import { coreMigrationsOf } from "@alxia/modules";
import { type Migration, migrationStatus } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { modules } from "../modules/registry";

// The core database's migrations, every module's in dependency order (the
// registry's `coreMigrations`). E1 adds the workspaces' own list.
export const migrations: readonly Migration[] = coreMigrationsOf(modules);

// The database has migrations this build lists that were not applied
// (`bun run db:migrate` applies them).
export class MigrationsOutOfSyncError extends Error {
  constructor(readonly pending: readonly string[]) {
    super(`${pending.length} migration(s) pending: run bun run db:migrate`);
    this.name = "MigrationsOutOfSyncError";
  }
}

// Refuses a database with a pending migration: what the server checks before it
// listens, so no request runs on texts a migration has yet to write. Answers
// the ids recorded but not in this build (a newer build already ran them: an
// old instance restarting during a rollout or a rollback must still start, so
// the caller warns and boots).
export async function assertMigrated(
  db: Db,
  list: readonly Migration[] = migrations,
): Promise<{ missing: string[] }> {
  const status = await migrationStatus(db, list);
  const ids = (state: string) =>
    status.filter((entry) => entry.state === state).map((entry) => entry.id);
  const pending = ids("pending");
  if (pending.length > 0) throw new MigrationsOutOfSyncError(pending);
  return { missing: ids("missing") };
}
