import { migrate } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { loadTranslations } from "../core/translations/translations.load";
import { core } from "./db";
import { assertMigrated, migrations } from "./migrations";

// What the server does before it listens: in development (`autoMigrate`) it
// applies the pending migrations itself; anywhere else a pending migration
// stops it (`MigrationsOutOfSyncError`), since `bun run db:migrate` is a
// deployment step, not something every instance races to do at boot. Then it
// loads the translations the API speaks from the database.
export async function boot(
  db: Db,
  options: { autoMigrate: boolean; list?: typeof migrations },
): Promise<void> {
  const list = options.list ?? migrations;
  if (options.autoMigrate) await migrate(db, [...list]);
  await assertMigrated(db, list);
  await loadTranslations(core);
}
