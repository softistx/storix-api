import { describe, expect, test } from "bun:test";
import { defineMigration, migrate, rollback } from "@softistx/mongo/migrations";
import { authValidationErrors } from "../core/translations/migrations/2026-11-13-auth-validation-errors.migration";
import { texts } from "../core/translations/migrations/2026-11-13-auth-validation-errors.texts";
import { seedsOf } from "../core/translations/translations.seeds";
import { connection } from "./db";
import {
  assertMigrated,
  MigrationsOutOfSyncError,
  migrations,
} from "./migrations";

// A database of its own on the shared in-memory server.
const db = connection.client.db("storix_migrations_spec");
const step = defineMigration({ id: "2026-01-01-extra", up: async () => {} });

describe("the core migrations", () => {
  test("the list is the registry's, ids unique and ordered by date", () => {
    expect(migrations.length).toBeGreaterThan(0);
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  test("assertMigrated refuses a pending migration, then passes once applied", async () => {
    await expect(assertMigrated(db, migrations)).rejects.toBeInstanceOf(
      MigrationsOutOfSyncError,
    );
    await migrate(db, [...migrations]);
    await assertMigrated(db, migrations);
  });

  test("assertMigrated reports a migration this build does not list, without refusing", async () => {
    await migrate(db, [...migrations, step]);
    expect(await assertMigrated(db, migrations)).toEqual({
      missing: [step.id],
    });
  });

  test("the auth and validation texts migration applies, rolls back and applies again", async () => {
    // This migration alone, so a later migration does not change the counts.
    const own = connection.client.db("storix_migrations_spec_down");
    const mine = [authValidationErrors];
    const expected = seedsOf(texts).length;
    const count = () => own.collection("translations").countDocuments();
    await migrate(own, mine);
    expect(await count()).toBe(expected);
    await rollback(own, mine);
    expect(await count()).toBe(0);
    await migrate(own, mine);
    expect(await count()).toBe(expected);
  });
});
