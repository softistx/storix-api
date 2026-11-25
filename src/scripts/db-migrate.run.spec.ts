import { afterAll, describe, expect, test } from "bun:test";
import type { MigrateMode, TenantMigration } from "@softistx/alxia-tenancy";
import { defineMigration } from "@softistx/mongo/migrations";
import { connection } from "../config/db";
import { runMigrate } from "./db-migrate.run";

const db = connection.client.db("storix_db_migrate_run_spec");
const first = defineMigration({ id: "2026-01-01-first", up: async () => {} });
const outcome = { database: "ws", ids: ["a"], status: [] };
const good: TenantMigration = {
  tenant: "w1",
  database: "ws_w1",
  ok: true,
  outcome,
};
const bad: TenantMigration = {
  tenant: "w2",
  database: "ws_w2",
  ok: false,
  error: new Error("boom"),
};

function run(
  mode: MigrateMode,
  results: TenantMigration[],
  tenantIds: string[] = ["2026-02-02-ws"],
) {
  const seen: MigrateMode[] = [];
  return {
    seen,
    done: runMigrate({
      core: db,
      coreList: [first],
      tenantIds,
      tenants: async (m) => {
        seen.push(m);
        return results;
      },
      mode,
    }),
  };
}

afterAll(async () => {
  await db.dropDatabase();
});

describe("the db:migrate script", () => {
  test("applies the core list and every workspace, exit 0", async () => {
    const r = run({ kind: "apply", dryRun: false }, [good]);
    const { lines, exitCode } = await r.done;
    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.startsWith("workspace w1"))).toBe(true);
    expect(r.seen).toEqual([{ kind: "apply", dryRun: false }]);
  });

  test("a failing workspace is reported, the others still listed, exit 1", async () => {
    const { lines, exitCode } = await run({ kind: "status" }, [bad, good]).done;
    expect(exitCode).toBe(1);
    expect(lines.find((l) => l.includes("w2"))).toContain("FAILED boom");
    expect(lines.find((l) => l.includes("w1"))).toContain("ok");
  });

  test("a rollback id only the workspace list holds skips the core", async () => {
    const r = run({ kind: "rollback", to: "2026-02-02-ws", dryRun: true }, [
      good,
    ]);
    const { lines, coreStatus } = await r.done;
    expect(coreStatus).toBeUndefined();
    expect(lines.some((l) => l.includes("core"))).toBe(false);
    expect(r.seen).toEqual([
      { kind: "rollback", to: "2026-02-02-ws", dryRun: true },
    ]);
  });

  test("a rollback id only the core list holds skips the workspaces", async () => {
    const r = run({ kind: "rollback", to: first.id, dryRun: true }, [good]);
    const { lines, coreStatus, exitCode } = await r.done;
    expect(r.seen).toHaveLength(0);
    expect(lines.some((l) => l.startsWith("workspace"))).toBe(false);
    expect(coreStatus?.map((s) => s.id)).toEqual([first.id]);
    expect(exitCode).toBe(0);
  });

  test("a rollback id both lists hold reaches the core and the workspaces", async () => {
    const r = run(
      { kind: "rollback", to: first.id, dryRun: true },
      [good],
      [first.id],
    );
    const { lines, coreStatus } = await r.done;
    expect(coreStatus).toBeDefined();
    expect(r.seen).toEqual([{ kind: "rollback", to: first.id, dryRun: true }]);
    expect(lines.some((l) => l.startsWith("workspace w1"))).toBe(true);
  });

  test("a rollback id no list holds is refused before anything runs", async () => {
    const r = run({ kind: "rollback", to: "nope", dryRun: false }, [good]);
    await expect(r.done).rejects.toThrow("no migration list holds");
    expect(r.seen).toHaveLength(0);
  });
});
