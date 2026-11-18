import { closeDatabases, core } from "../config/db";
import { store } from "../config/tenancy";
import { runRetention } from "./retention.run";

// The hourly `retention` job (plan §3.9, §3.14): per active workspace, purges
// what has been in the trash longer than its `trashDays`, then drops the file
// versions past its `versionsMax` newest and those older than its
// `versionsDays`, never a file's current one. The blobs nothing holds are
// released and the sweep (`bun run storage:sweep`) removes them. Schedule it
// from the host until the worker runs it; it exits 1 when a workspace failed.
//
//   bun run retention
try {
  const { summary, exitCode } = await runRetention(core, (id) =>
    store.databaseOf(id),
  );
  console.log(summary);
  process.exitCode = exitCode;
} finally {
  await closeDatabases();
}
