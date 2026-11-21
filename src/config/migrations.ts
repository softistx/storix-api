import { coreMigrationsOf } from "@softistx/alxia-modules";
import { type Migration, migrationStatus } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { modules } from "../modules/registry";

// The core database's migrations: every module's `coreMigrations`, in id order
// (ids start with their date; the store sorts its own copy the same way, this
// one serves the boot check). The runner refuses a pending migration listed
// before an applied one, so a migration a later module adds must sort after
// the ones a database already ran: grouping by module would put it mid-list.
export const migrations: readonly Migration[] = coreMigrationsOf(
  modules,
).toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
  const { pending, missing } = await migrationState(db, list);
  if (pending.length > 0) throw new MigrationsOutOfSyncError(pending);
  return { missing };
}

// The ids this build lists that are not applied (`pending`) and the ids
// recorded that this build does not list (`missing`).
export async function migrationState(
  db: Db,
  list: readonly Migration[] = migrations,
): Promise<{ pending: string[]; missing: string[] }> {
  const status = await migrationStatus(db, list);
  const ids = (state: string) =>
    status.filter((entry) => entry.state === state).map((entry) => entry.id);
  return { pending: ids("pending"), missing: ids("missing") };
}
