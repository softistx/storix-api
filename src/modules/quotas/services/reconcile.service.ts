import { setUsage, storageOf, type WorkspacesMongo } from "@/core/workspaces";
import {
  type FilesMongo,
  filesMongo,
  recountStorage,
} from "@/modules/files/public";

interface Counted {
  bytes: number;
  files: number;
  versionBytes: number;
  trashBytes: number;
}

export interface Reconciled {
  workspaceId: string;
  before: Counted;
  after: Counted;
  drift: boolean;
}

// Recounts a workspace's usage from its blobs and nodes and sets the counters
// to it (plan §3.14, `reconcile`). The recount and the write are one
// transaction on the workspace's database and the core one: an upload that
// commits in between conflicts with the write and the transaction runs again
// on a fresh snapshot, so the recount never overwrites a newer counter.
export async function reconcileUsage(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
): Promise<Reconciled> {
  return mongo.transaction(async (tx) => {
    const coreTx = core.withSession(tx.session);
    const stored = await storageOf(coreTx, workspaceId);
    const before = {
      bytes: stored?.usage.bytes ?? 0,
      files: stored?.usage.files ?? 0,
      versionBytes: stored?.usage.versionBytes ?? 0,
      trashBytes: stored?.usage.trashBytes ?? 0,
    };
    const after = await recountStorage(tx);
    const drift =
      before.bytes !== after.bytes ||
      before.files !== after.files ||
      before.versionBytes !== after.versionBytes ||
      before.trashBytes !== after.trashBytes;
    if (drift) await setUsage(coreTx, workspaceId, after);
    return { workspaceId, before, after, drift };
  });
}

// Reconciles every active workspace, one after the other; a workspace that
// fails is reported and does not stop the others.
export async function reconcileAll(
  core: WorkspacesMongo,
  databaseOf: (workspaceId: string) => Promise<unknown>,
): Promise<{
  done: Reconciled[];
  failed: { workspaceId: string; error: unknown }[];
}> {
  const workspaces = await core.db.workspaces.findMany({
    filter: { status: "active" },
  });
  const done: Reconciled[] = [];
  const failed: { workspaceId: string; error: unknown }[] = [];
  for (const workspace of workspaces) {
    try {
      const mongo = filesMongo(await databaseOf(workspace.id));
      done.push(await reconcileUsage(mongo, core, workspace.id));
    } catch (error) {
      failed.push({ workspaceId: workspace.id, error });
    }
  }
  return { done, failed };
}
