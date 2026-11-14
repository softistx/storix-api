import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { defineMigration, migrate, rollback } from "@softistx/mongo/migrations";
import { boot } from "./boot";
import { connection } from "./db";
import { env } from "./env";
import { MigrationsOutOfSyncError, migrations } from "./migrations";

// The core database itself: `boot` loads the translations from it. Other specs
// migrate it too, so each case sets up its own state.
const db = connection.client.db(env.MONGO_CORE_DATABASE);
const later = defineMigration({
  id: "2099-01-01-later",
  up: async () => {},
  down: async () => {},
});

let warn: ReturnType<typeof spyOn<Console, "warn">> | undefined;
afterEach(async () => {
  warn?.mockRestore();
  // `later` is recorded by a case: undo it, since other specs migrate this
  // database with the build's own list.
  await rollback(db, [...migrations, later], {
    to: migrations.at(-1)?.id ?? "",
  });
});

describe("boot", () => {
  test("refuses to boot while a migration is pending, then boots once migrated", async () => {
    const list = [...migrations, later];
    await migrate(db, [...migrations]);
    await expect(boot(db, { autoMigrate: false, list })).rejects.toBeInstanceOf(
      MigrationsOutOfSyncError,
    );
    await migrate(db, list);
    await boot(db, { autoMigrate: false, list });
  });

  test("boots with a warning when a migration is recorded but not in this build", async () => {
    await migrate(db, [...migrations, later]);
    warn = spyOn(console, "warn").mockImplementation(() => {});
    await boot(db, { autoMigrate: false, list: [...migrations] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "recorded but not in this build: 2099-01-01-later",
    );
  });

  test("with autoMigrate, a recorded-but-unknown migration warns and boots instead of failing", async () => {
    await migrate(db, [...migrations, later]);
    warn = spyOn(console, "warn").mockImplementation(() => {});
    await boot(db, { autoMigrate: true, list: [...migrations] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("syncs the identity's collections first when it is given", async () => {
    await migrate(db, [...migrations]);
    const order: string[] = [];
    await boot(db, {
      autoMigrate: false,
      identity: {
        syncStores: async () => {
          order.push("identity");
          return [];
        },
      },
    });
    expect(order).toEqual(["identity"]);
  });
});
