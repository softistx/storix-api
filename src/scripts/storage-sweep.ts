import { bucket } from "../config/bucket";
import { closeDatabases, core } from "../config/db";
import { appRedis, closeQueues } from "../config/redis";
import { store } from "../config/tenancy";
import { runStorageSweep } from "./storage-sweep.run";

// The hourly `sweep` job (plan §3.14): per active workspace, removes the blobs
// nothing references (`refs` 0) with their objects and sizes, and the objects
// of a `/media` PUT that `addFile` never recorded once they are 75 minutes
// old. Usage is not touched. Schedule it from the host (cron, a systemd
// timer) until the worker runs it; it exits 1 when a workspace failed, a stuck file
// was left for the next run (`nodesLeft`) or no bucket is configured.
//
//   bun run storage:sweep
try {
  if (!bucket) {
    console.error(
      "no bucket: set S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY to sweep",
    );
    process.exitCode = 1;
  } else {
    const { summary, exitCode } = await runStorageSweep(
      core,
      (id) => store.databaseOf(id),
      bucket,
      appRedis?.queues.renditions,
    );
    console.log(summary);
    process.exitCode = exitCode;
  }
} finally {
  await closeDatabases();
  await closeQueues();
}
