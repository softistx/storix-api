import { closeDatabases, core } from "../config/db";
import { store } from "../config/tenancy";
import { reconcileAll } from "../modules/quotas/public";

// The nightly `reconcile` job (plan §3.14): recounts every active workspace's
// usage from its blobs and nodes and corrects the counters that drifted.
// Schedule it from the host (cron, a systemd timer); it exits 1 when a
// workspace failed.
//
//   bun run quota:reconcile
try {
  const { done, failed } = await reconcileAll(core, (id) =>
    store.databaseOf(id),
  );
  for (const r of done.filter((d) => d.drift)) {
    console.warn(
      `workspace ${r.workspaceId}: usage ${r.before.bytes} bytes / ${r.before.files} files corrected to ${r.after.bytes} / ${r.after.files}`,
    );
  }
  for (const f of failed) {
    console.error(`workspace ${f.workspaceId}: not reconciled:`, f.error);
  }
  console.log(
    `reconciled ${done.length} workspaces, ${done.filter((d) => d.drift).length} corrected, ${failed.length} failed`,
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  await closeDatabases();
}
