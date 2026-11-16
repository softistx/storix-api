import { closeDatabases, core } from "../config/db";
import { store } from "../config/tenancy";
import { retainAll } from "../modules/files/public";
import { retainTrashAll } from "../modules/trash/public";

// The hourly `retention` job (plan §3.9, §3.14): per active workspace, purges
// what has been in the trash longer than its `trashDays`, then drops the file
// versions past its `versionsMax` newest and those older than its
// `versionsDays`, never a file's current one. The blobs nothing holds are
// released and the sweep (`bun run storage:sweep`) removes them. Schedule it
// from the host until the worker runs it; it exits 1 when a workspace failed.
//
//   bun run retention
try {
  const databaseOf = (id: string) => store.databaseOf(id);
  const trash = await retainTrashAll(core, databaseOf);
  const versions = await retainAll(core, databaseOf);
  for (const f of [...trash.failed, ...versions.failed]) {
    console.error(`workspace ${f.workspaceId}: not settled:`, f.error);
  }
  const entriesFailed =
    trash.done.reduce((sum, r) => sum + r.failed, 0) +
    versions.done.reduce((sum, r) => sum + r.failed, 0);
  const purged = trash.done.reduce((sum, r) => sum + r.removed, 0);
  const dropped = versions.done.reduce((sum, r) => sum + r.removed, 0);
  console.log(
    `trash: ${purged} nodes purged; versions: ${dropped} removed; ${trash.failed.length + versions.failed.length} workspaces and ${entriesFailed} trash entries or files failed`,
  );
  if (trash.failed.length + versions.failed.length + entriesFailed > 0)
    process.exitCode = 1;
} finally {
  await closeDatabases();
}
