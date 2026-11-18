import type { WorkspacesMongo } from "../core/workspaces";
import { retainAll } from "../modules/files/public";
import { retainTrashAll } from "../modules/trash/public";

// The hourly `retention` job's body, apart from its process wiring so a spec
// can run it: trash retention, then version retention, per active workspace.
// Answers the summary line and the exit code: 1 when a workspace failed or an
// entry or a file could not be settled, else 0.
export async function runRetention(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
): Promise<{ summary: string; exitCode: 0 | 1 }> {
  const trash = await retainTrashAll(core, databaseOf);
  const versions = await retainAll(core, databaseOf);
  for (const f of [...trash.failed, ...versions.failed]) {
    console.error(`workspace ${f.workspaceId}: not settled:`, f.error);
  }
  const workspacesFailed = trash.failed.length + versions.failed.length;
  const entriesFailed =
    trash.done.reduce((sum, r) => sum + r.failed, 0) +
    versions.done.reduce((sum, r) => sum + r.failed, 0);
  const purged = trash.done.reduce((sum, r) => sum + r.removed, 0);
  const dropped = versions.done.reduce((sum, r) => sum + r.removed, 0);
  return {
    summary: `trash: ${purged} nodes purged; versions: ${dropped} removed; ${workspacesFailed} workspaces and ${entriesFailed} trash entries or files failed`,
    exitCode: workspacesFailed + entriesFailed > 0 ? 1 : 0,
  };
}
