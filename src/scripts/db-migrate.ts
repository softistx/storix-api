import { migrate, migrationStatus, rollback } from "@softistx/mongo/migrations";
import { closeDatabases, connection } from "../config/db";
import { env } from "../config/env";
import { migrations } from "../config/migrations";

// A deployment step, after `bun run db:sync` and before the new code rolls:
// applies the pending migrations of the core database (the translations'
// texts) and prints each one's state. It writes the global collections, so it
// runs with a credential that may write them. Never run from a request.
//
//   bun run db:migrate                      apply what is pending
//   bun run db:migrate --dry-run            list what would run, write nothing
//   bun run db:migrate --status             print the states only
//   bun run db:migrate --rollback-to <id>   undo everything after <id>
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rollbackAt = args.indexOf("--rollback-to");
const target = rollbackAt === -1 ? undefined : args[rollbackAt + 1];

const db = connection.client.db(env.MONGO_CORE_DATABASE);
try {
  if (rollbackAt !== -1) {
    if (target === undefined) throw new Error("--rollback-to needs an id");
    console.log(await rollback(db, [...migrations], { to: target, dryRun }));
  } else if (!args.includes("--status")) {
    console.log(await migrate(db, [...migrations], { dryRun }));
  }
  console.table(await migrationStatus(db, [...migrations]));
} finally {
  await closeDatabases();
}
