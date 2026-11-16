import { closeDatabases, core } from "../config/db";
import { store } from "../config/tenancy";
import { retainAll } from "../modules/files/public";

// The hourly `retention` job's versions part (plan §3.9, §3.14): per active
// workspace, drops the versions past the newest 20 and those older than 90
// days, never a file's current one; the blobs nothing holds are released and
// the sweep (`bun run storage:sweep`) removes them. Schedule it from the host
// until the worker runs it; it exits 1 when a workspace failed.
//
//   bun run versions:retention
try {
  const { done, failed } = await retainAll(core, (id) => store.databaseOf(id));
  for (const f of failed) {
    console.error(`workspace ${f.workspaceId}: not settled:`, f.error);
  }
  const removed = done.reduce((sum, r) => sum + r.removed, 0);
  console.log(
    `settled ${done.length} workspaces: ${removed} versions removed, ${failed.length} workspaces failed`,
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  await closeDatabases();
}
