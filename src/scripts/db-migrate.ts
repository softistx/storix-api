import { migrationsOf } from "@softistx/alxia-modules";
import { closeDatabases, connection } from "../config/db";
import { env } from "../config/env";
import { migrations } from "../config/migrations";
import { store } from "../config/tenancy";
import { modules } from "../modules/registry";
import { runMigrate } from "./db-migrate.run";
import { parseMode } from "./db-migrate-args";

// A deployment step, after `bun run db:sync` and before the new code rolls:
// applies the pending migrations of the core database (the translations'
// texts) and of every workspace database (indexes first, then the workspace
// migrations), and prints each one's state. It writes the global collections,
// so it runs with a credential that may write them. Never run from a request.
// It exits 1 when a workspace failed; the others are still migrated.
//
//   bun run db:migrate                      apply what is pending
//   bun run db:migrate --dry-run            list what would run, write nothing
//   bun run db:migrate --status             print the states only
//   bun run db:migrate --rollback-to <id>   undo everything after <id>
//                                           (a core id leaves the workspaces
//                                           alone, and the reverse)
try {
  const mode = parseMode(Bun.argv.slice(2));
  const { lines, coreStatus, exitCode } = await runMigrate({
    core: connection.client.db(env.MONGO_CORE_DATABASE),
    coreList: migrations,
    tenantIds: migrationsOf(modules).map((m) => m.id),
    tenants: (m) => store.migrateTenants(m),
    mode,
  });
  for (const line of lines) console.log(line);
  if (coreStatus) {
    console.log("core:");
    console.table(coreStatus);
  }
  process.exitCode = exitCode;
} finally {
  await closeDatabases();
}
