import { migrate } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { loadTranslations } from "../core/translations/translations.load";
import { core } from "./db";
import { assertMigrated, migrationState, migrations } from "./migrations";

// What the server does before it listens. It reads the migration status
// first. A migration recorded but not in this build (a newer build ran it)
// only logs a warning, and then nothing is applied, so an old instance
// restarting during a rollout or a code rollback still starts (and dev warns
// the same way). Otherwise, outside production (`autoMigrate`) it applies the
// pending migrations itself; in production a pending migration stops it
// (`MigrationsOutOfSyncError`), since `bun run db:migrate` is a deployment
// step, not something every instance races to do at boot. Then it loads the
// translations the API speaks from the database (docs/development.md, "Boot
// and deploy").
export async function boot(
  db: Db,
  options: { autoMigrate: boolean; list?: typeof migrations },
): Promise<void> {
  const list = options.list ?? migrations;
  const { missing } = await migrationState(db, list);
  if (missing.length > 0) {
    console.warn(
      `${missing.length} migration(s) recorded but not in this build: ${missing.join(", ")}`,
    );
  } else if (options.autoMigrate) {
    await migrate(db, [...list]);
  }
  await assertMigrated(db, list);
  await loadTranslations(core);
}
