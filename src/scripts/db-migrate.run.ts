import type { MigrateMode, TenantMigration } from "@alxia/tenancy";
import {
  type Migration,
  migrate,
  migrationStatus,
  rollback,
} from "@softistx/mongo/migrations";
import type { Db } from "mongodb";

// The `db:migrate` body, apart from its process wiring so a spec can run it:
// the core database with its list, then every workspace database with
// `store.migrateTenants` (which syncs the indexes first on an apply, visits
// every workspace and reports a failing one without stopping the others).
// Answers what to print and the exit code: 1 when a workspace failed.
export interface MigrateRun {
  core: Db;
  coreList: readonly Migration[];
  // The ids of the workspace list, to route a rollback to the list that holds it.
  tenantIds: readonly string[];
  tenants: (mode: MigrateMode) => Promise<TenantMigration[]>;
  mode: MigrateMode;
}

export async function runMigrate(
  run: MigrateRun,
): Promise<{ lines: string[]; exitCode: 0 | 1 }> {
  const { core, mode } = run;
  const list = [...run.coreList];
  const lines: string[] = [];
  let toCore = true;
  let toTenants = true;
  if (mode.kind === "rollback") {
    toCore = list.some((m) => m.id === mode.to);
    toTenants = run.tenantIds.includes(mode.to);
    if (!toCore && !toTenants) {
      throw new Error(`--rollback-to: no migration list holds "${mode.to}"`);
    }
  }
  if (toCore) {
    if (mode.kind === "apply") {
      lines.push(
        JSON.stringify(await migrate(core, list, { dryRun: mode.dryRun })),
      );
    } else if (mode.kind === "rollback") {
      lines.push(
        JSON.stringify(
          await rollback(core, list, { to: mode.to, dryRun: mode.dryRun }),
        ),
      );
    }
    lines.push(`core: ${JSON.stringify(await migrationStatus(core, list))}`);
  }
  let exitCode: 0 | 1 = 0;
  if (toTenants) {
    for (const result of await run.tenants(mode)) {
      if (result.ok) {
        lines.push(
          `workspace ${result.tenant} (${result.database}): ok ${JSON.stringify(result.outcome.ids)}`,
        );
      } else {
        exitCode = 1;
        const error =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        lines.push(
          `workspace ${result.tenant} (${result.database}): FAILED ${error}`,
        );
      }
    }
  }
  return { lines, exitCode };
}
