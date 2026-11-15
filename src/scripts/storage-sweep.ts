import { bucket } from "../config/bucket";
import { closeDatabases, core } from "../config/db";
import { store } from "../config/tenancy";
import { sweepAll } from "../modules/files/public";

// The hourly `sweep` job (plan §3.14): per active workspace, removes the blobs
// nothing references (`refs` 0) with their objects and sizes, and the objects
// of a `/media` PUT that `addFile` never recorded once they are 75 minutes
// old. Usage is not touched. Schedule it from the host (cron, a systemd
// timer) until the worker runs it; it exits 1 when a workspace failed or no
// bucket is configured.
//
//   bun run storage:sweep
try {
  if (!bucket) {
    console.error(
      "no bucket: set S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY to sweep",
    );
    process.exitCode = 1;
  } else {
    const { done, failed } = await sweepAll(
      core,
      (id) => store.databaseOf(id),
      bucket,
    );
    for (const f of failed) {
      console.error(`workspace ${f.workspaceId}: not swept:`, f.error);
    }
    const total = (pick: (r: (typeof done)[number]) => number) =>
      done.reduce((sum, r) => sum + pick(r), 0);
    console.log(
      `swept ${done.length} workspaces: ${total((r) => r.released)} released blobs, ${total((r) => r.orphans)} orphan objects, ${total((r) => r.failed)} not removed, ${failed.length} workspaces failed`,
    );
    if (failed.length > 0 || total((r) => r.failed) > 0) process.exitCode = 1;
  }
} finally {
  await closeDatabases();
}
