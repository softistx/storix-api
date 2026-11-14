import { describe, expect, test } from "bun:test";
import { defineMigration, migrate, rollback } from "@softistx/mongo/migrations";
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

  test("assertMigrated refuses a migration this build does not list", async () => {
    await migrate(db, [...migrations, step]);
    await expect(assertMigrated(db, migrations)).rejects.toThrow(
      "recorded but not in this build",
    );
  });

  test("the first migration rolls back and applies again", async () => {
    const own = connection.client.db("storix_migrations_spec_down");
    await migrate(own, [...migrations]);
    const count = () => own.collection("translations").countDocuments();
    expect(await count()).toBe(34);
    await rollback(own, [...migrations]);
    expect(await count()).toBe(0);
    await migrate(own, [...migrations]);
    expect(await count()).toBe(34);
  });
});
