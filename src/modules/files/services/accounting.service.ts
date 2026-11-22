import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import { sessionOf } from "@/modules/nodes/public";
import type { FilesMongo } from "../models";
import { counted, type Held } from "../utils";

// Where a blob stands in the workspace's counters (plan §3.9): held by a live
// node (`live`, the current files), held only by trashed nodes (`trash`), held
// by no node at all, only by version rows (`versions`), or not held (`none`: a
// blob with `refs` 0 is released and no longer counts). A blob is in exactly
// one state, so `usage.bytes` is the sum of the three counted ones and
// `versionBytes` and `trashBytes` are two of its parts.
export type BlobState = "none" | "live" | "trash" | "versions";

// The state of each of these blobs, read in the caller's transaction.
async function states(
  tx: FilesMongo,
  keys: readonly string[],
): Promise<Map<string, Held>> {
  const found = new Map<string, Held>();
  if (keys.length === 0) return found;
  const blobs = await tx.db.blobs.findMany({ filter: { key: { $in: keys } } });
  const distinct = async (extra: Record<string, unknown>) => {
    const held: unknown[] = await tx.db.nodes.raw.distinct(
      "blobKey",
      { blobKey: { $in: keys }, ...extra },
      sessionOf(tx),
    );
    return new Set(held);
  };
  const live = await distinct({ trashedAt: null });
  const any = await distinct({});
  for (const blob of blobs) {
    const state: BlobState =
      blob.refs <= 0
        ? "none"
        : live.has(blob.key)
          ? "live"
          : any.has(blob.key)
            ? "trash"
            : "versions";
    found.set(blob.key, { size: blob.size, state });
  }
  return found;
}

// Runs a write that changes who holds these blobs (a version pushed or
// removed, nodes trashed, restored or purged) and moves the workspace's
// counters by what it changed, in the same transaction: each blob's state is
// read before and after, and the difference is the delta. `files` is the
// change in live file nodes, which the caller knows. A write that raises
// `bytes` past the quota is `quotas.errors.exceeded` and the transaction is
// undone with it. `quota:reconcile` recounts the same three figures.
export async function accounted<T>(
  tx: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  keys: Iterable<string>,
  work: () => Promise<T>,
  files: () => number | Promise<number> = () => 0,
): Promise<T> {
  const unique = [...new Set(keys)].filter(
    (key): key is string => typeof key === "string" && key !== "",
  );
  const before = await states(tx, unique);
  const result = await work();
  const after = await states(tx, unique);
  const delta = {
    bytes: 0,
    files: await files(),
    versionBytes: 0,
    trashBytes: 0,
  };
  for (const key of unique) {
    const was = counted(before.get(key));
    const now = counted(after.get(key) ?? before.get(key));
    delta.bytes += now.bytes - was.bytes;
    delta.versionBytes += now.versionBytes - was.versionBytes;
    delta.trashBytes += now.trashBytes - was.trashBytes;
  }
  if (
    delta.bytes !== 0 ||
    delta.files !== 0 ||
    delta.versionBytes !== 0 ||
    delta.trashBytes !== 0
  ) {
    await addUsage(core.withSession(tx.session), workspaceId, delta);
  }
  return result;
}
