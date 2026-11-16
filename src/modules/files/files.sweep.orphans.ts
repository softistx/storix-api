import { isMediaKey } from "@alxia/media";
import { ConflictError } from "@softistx/mongo";
import { removeObjects, type Sweep } from "./files.sweep.run";

/**
 * A page of this many old, distinct keys that no blob records, in a workspace
 * whose `blobs` collection is empty, is not swept: a wrong database against
 * the real bucket would otherwise wipe it.
 */
export const ORPHAN_BRAKE = 10;

// Reserves a key nobody records: a blob with `refs` 0 under it. `addFile`
// finds a blob and refuses the key (`key-unknown`), and a key it recorded
// first makes the insert conflict, so a recorded object is never deleted.
async function claim(run: Sweep, key: string): Promise<boolean> {
  try {
    await run.mongo.db.blobs.create({
      key,
      size: 0,
      mimeType: "application/octet-stream",
      refs: 0,
    });
    return true;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}

// The objects under the workspace's `files` prefix that no blob records and
// that were last written before the margin: a `/media` PUT that `addFile`
// never recorded, and its sizes. Each key is claimed, its objects removed,
// then the claim lifted (a claim a crash left is a released blob the next run
// removes).
export async function sweepOrphans(run: Sweep) {
  const blobs = run.mongo.db.blobs;
  const prefix = `workspaces/${run.workspaceId}/files/`;
  const cutoff = run.now().getTime() - run.margin;
  for (let cursor: string | null = null; run.left > 0; ) {
    const page: Awaited<ReturnType<Sweep["bucket"]["list"]>> =
      await run.bucket.list({ prefix, limit: run.batch, cursor });
    const old = new Map<string, string[]>();
    for (const item of page.items) {
      const key = item.key.slice(prefix.length).split("/")[0] ?? "";
      const at = item.lastModified?.getTime();
      if (!isMediaKey(key) || at === undefined || at >= cutoff) continue;
      old.set(key, [...(old.get(key) ?? []), item.key]);
    }
    const keys = [...old.keys()];
    if (keys.length > 0) {
      const held = await blobs.raw
        .find({ key: { $in: keys } }, { projection: { key: 1 } })
        .toArray();
      const recorded = new Set(held.map((blob) => blob.key));
      const orphans = keys.filter((key) => !recorded.has(key));
      if (
        orphans.length >= ORPHAN_BRAKE &&
        orphans.length === keys.length &&
        (await blobs.raw.estimatedDocumentCount()) === 0
      ) {
        run.log(
          `storage sweep ${run.workspaceId} stopped: no blob records any of ${orphans.length} old keys on a page`,
        );
        return;
      }
      for (const key of orphans) {
        if (run.left <= 0) return;
        if (!(await claim(run, key))) continue;
        const objects = old.get(key) ?? [];
        const failed = await removeObjects(run, objects);
        await blobs.raw.deleteOne({ key, refs: 0 });
        run.report.failed += failed;
        run.report.orphans += objects.length - failed;
      }
    }
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}
