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
// or the queue refused a job and left stuck files for the next run.
export async function runStorageSweep(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
  bucket: SweepBucket,
  renditions?: RenditionsQueue,
): Promise<{ summary: string; exitCode: 0 | 1 }> {
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
    summary: `swept ${done.length} workspaces: ${total((r) => r.released)} released blobs, ${total((r) => r.orphans)} orphan objects, ${total((r) => r.failed)} not removed, ${total((r) => r.stuck?.requeued ?? 0)} stuck files queued again, ${total((r) => r.stuck?.failed ?? 0)} given up, ${nodesLeft} stuck files left for the next run, ${failed.length} workspaces failed`,
    exitCode:
      failed.length > 0 || total((r) => r.failed) > 0 || nodesLeft > 0 ? 1 : 0,
  };
}
