import { describe, expect, test } from "bun:test";
import { seedsOf } from "@alxia/i18n";
import { migrationsOf } from "@alxia/modules";
import { defineMigration, migrate, rollback } from "@softistx/mongo/migrations";
import { authValidationErrors } from "../core/translations/migrations/2026-11-13-auth-validation-errors.migration";
import { texts } from "../core/translations/migrations/2026-11-13-auth-validation-errors.texts";
import { modules } from "../modules/registry";
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

  // The ids a database may already have applied (what `develop` shipped before
  // E3), in order. A new migration is listed after them, never among them: the
  // runner throws "pending and listed before one that is already applied".
  // Append each id here once it ships on develop; a new migration's id must
  // sort after the last shipped one.
  const SHIPPED_CORE = [
    "2026-11-13-auth-validation-errors",
    "2026-11-14-identity-errors",
    "2026-11-14-workspaces-errors",
    "2026-11-15-invitations-errors",
    "2026-11-15-teams-errors",
    "2026-11-16-nodes-errors",
    "2026-11-16-storage-errors",
    "2026-11-17-files-errors",
    "2026-11-18-files-copy-errors",
    "2026-11-19-quotas-errors",
    "2026-11-20-files-focal-errors",
    "2026-11-20-workspaces-quota",
    "2026-11-21-versions-errors",
    "2026-11-21-versions-trash-errors",
    "2026-11-21-workspaces-settings",
    "2026-11-22-invitations-states-errors",
  ];
  const SHIPPED_WORKSPACE = [
    "2026-11-15-nodes-listing-collation",
    "2026-11-21-nodes-trash-indexes",
    "2026-11-21-versions-indexes",
    "2026-11-24-nodes-listing-desc-indexes",
  ];

  test("the core ids a database already ran are a frozen prefix of the list", () => {
    const ids = migrations.map((m) => m.id);
    expect(ids.slice(0, SHIPPED_CORE.length)).toEqual(SHIPPED_CORE);
  });

  test("the workspace ids a database already ran are a frozen prefix of its list", () => {
    const ids = migrationsOf(modules).map((m) => m.id);
    expect(ids.slice(0, SHIPPED_WORKSPACE.length)).toEqual(SHIPPED_WORKSPACE);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  test("every migration not yet shipped sorts after the last shipped id", () => {
    const after = (all: string[], shipped: string[]) =>
      all.slice(shipped.length).every((id) => id > (shipped.at(-1) ?? ""));
    expect(
      after(
        migrations.map((m) => m.id),
        SHIPPED_CORE,
      ),
    ).toBe(true);
    expect(
      after(
        migrationsOf(modules).map((m) => m.id),
        SHIPPED_WORKSPACE,
      ),
    ).toBe(true);
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
