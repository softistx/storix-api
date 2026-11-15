import { identity } from "../config/auth";
import { closeDatabases, core } from "../config/db";

// A deployment step: brings every core collection's validator and indexes to
// what its definition says and prints what changed. `collMod` needs the
// dbAdmin role, which the app itself should not hold. Run it before
// `db:migrate`.
//
//   bun run db:sync              sync
//   bun run db:sync --dry-run    list what would change, change nothing
const dryRun = Bun.argv.slice(2).includes("--dry-run");
try {
  console.log(JSON.stringify(await core.sync({ dryRun }), null, 2));
  // The identity's own collections (users, sessions, tokens, relations, keys).
  console.log(JSON.stringify(await identity.syncStores({ dryRun }), null, 2));
} finally {
  await closeDatabases();
}
