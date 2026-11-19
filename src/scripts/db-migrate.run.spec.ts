import { describe, expect, test } from "bun:test";
import type { MigrateMode, TenantMigration } from "@alxia/tenancy";
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

function run(mode: MigrateMode, results: TenantMigration[]) {
  const seen: MigrateMode[] = [];
  return {
    seen,
    done: runMigrate({
      core: db,
      coreList: [first],
      tenantIds: ["2026-02-02-ws"],
      tenants: async (m) => {
        seen.push(m);
        return results;
      },
      mode,
    }),
  };
}

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
    const { lines } = await r.done;
    expect(lines.some((l) => l.startsWith("core:"))).toBe(false);
    expect(r.seen).toHaveLength(1);
  });

  test("a rollback id no list holds is refused before anything runs", async () => {
    const r = run({ kind: "rollback", to: "nope", dryRun: false }, [good]);
    await expect(r.done).rejects.toThrow("no migration list holds");
    expect(r.seen).toHaveLength(0);
  });
});
