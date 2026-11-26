import type { WorkspacesMongo } from "../core/workspaces";
import {
  type RenditionsQueue,
  type SweepBucket,
  sweepAll,
} from "../modules/files/public";

// The hourly `storage:sweep` job's body, apart from its process wiring so a
// spec can run it. `renditions` is the queue the stuck-files step hands its
// jobs to: given only when Redis is configured. Answers the summary line and
// the exit code: 1 when a workspace failed, an object or blob was not removed,
// or the queue refused a job and left stuck files for the next run; 2 when a
// brake stopped a workspace (checked first: look at the bucket and the
// database before the next run). A hit cap is printed and exits 0: the next run
// goes on.
export async function runStorageSweep(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
  bucket: SweepBucket,
  renditions?: RenditionsQueue,
): Promise<{ summary: string; exitCode: 0 | 1 | 2 }> {
  const { done, failed } = await sweepAll(
    core,
    databaseOf,
    bucket,
    renditions ? { renditions } : {},
  );
  for (const f of failed) {
    console.error(`workspace ${f.workspaceId}: not swept:`, f.error);
  }
  const total = (pick: (r: (typeof done)[number]) => number) =>
    done.reduce((sum, r) => sum + pick(r), 0);
  const nodesLeft = total((r) => r.stuck?.nodesLeft ?? 0);
  return {
    summary: `swept ${done.length} workspaces: ${total((r) => r.released)} released blobs, ${total((r) => r.orphans)} orphan objects, ${total((r) => r.failed)} not removed, ${total((r) => r.stuck?.requeued ?? 0)} stuck files queued again, ${total((r) => r.stuck?.failed ?? 0)} given up, ${nodesLeft} stuck files left for the next run, ${done.filter((r) => r.skipped).length} workspaces skipped (another sweep held the lock), ${done.filter((r) => r.braked).length} workspaces braked (stopped by a safety brake), ${done.filter((r) => r.capped).length} workspaces capped (more left for the next run), ${failed.length} workspaces failed`,
    exitCode: done.some((r) => r.braked)
      ? 2
      : failed.length > 0 || total((r) => r.failed) > 0 || nodesLeft > 0
        ? 1
        : 0,
  };
}
