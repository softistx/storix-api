import type { WorkspacesMongo } from "@/core/workspaces";
import {
  accounted,
  type FilesMongo,
  releaseBlobs,
} from "@/modules/files/public";
import {
  lockTree,
  type NodeDoc,
  named,
  nodesMongo,
  sessionOf,
} from "@/modules/nodes/public";
import { dropGrants } from "@/modules/shares/public";
import { topsOf } from "../utils";
import { entryOf } from "./entries.service";

interface Done {
  workspaceId: string;
  accountId: string;
}

// Deletes a trash entry and everything under it, in the caller's transaction:
// the nodes, their versions, stars, recents and grants, and one hold on a blob per
// node and per version row that named it (`releaseBlobs`: a blob nothing
// holds is released for the sweep). The counters follow the blobs' states
// (`accounted`): the bytes leave `trashBytes` and `bytes`, or become
// `versionBytes` when a version of another file still holds them. Answers the
// nodes removed.
export async function purgeTop(
  tx: FilesMongo,
  core: WorkspacesMongo,
  workspaceId: string,
  top: NodeDoc,
): Promise<number> {
  const session = sessionOf(tx);
  const subtree = { $or: [{ _id: top._id }, { ancestors: top._id }] };
  const ids: NodeDoc["_id"][] = await tx.db.nodes.raw.distinct(
    "_id",
    subtree,
    session,
  );
  const holds = new Map<string, number>();
  const count = (rows: { _id: string; n: number }[]) => {
    for (const { _id, n } of rows) holds.set(_id, (holds.get(_id) ?? 0) + n);
  };
  const byKey = [{ $group: { _id: "$blobKey", n: { $sum: 1 } } }];
  count(
    await tx.db.nodes.raw
      .aggregate<{ _id: string; n: number }>(
        [{ $match: { ...subtree, blobKey: { $ne: null } } }, ...byKey],
        session,
      )
      .toArray(),
  );
  count(
    await tx.db.versions.raw
      .aggregate<{ _id: string; n: number }>(
        [{ $match: { fileId: { $in: ids } } }, ...byKey],
        session,
      )
      .toArray(),
  );
  return accounted(tx, core, workspaceId, holds.keys(), async () => {
    await tx.db.versions.raw.deleteMany({ fileId: { $in: ids } }, session);
    await tx.db.stars.raw.deleteMany({ nodeId: { $in: ids } }, session);
    await tx.db.recents.raw.deleteMany({ nodeId: { $in: ids } }, session);
    await dropGrants(
      tx,
      ids.map((id) => id.toHexString()),
    );
    const removed = await tx.db.nodes.raw.deleteMany(
      { _id: { $in: ids } },
      session,
    );
    await releaseBlobs(tx, holds);
    return removed.deletedCount;
  });
}

// One entry, in a transaction of its own under its owner's tree lock; the
// entry is read again inside it, so a restore that came first wins
// (`trash.errors.not-trashed`).
export async function purgeEntry(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: Done & { id: string },
): Promise<{ entry: NodeDoc; removed: number }> {
  return named(() =>
    mongo.transaction(async (tx) => {
      const nodes = nodesMongo(tx);
      await lockTree(nodes, input.accountId);
      const entry = await entryOf(nodes, input.id, input.accountId);
      const removed = await purgeTop(tx, core, input.workspaceId, entry);
      return { entry, removed };
    }),
  );
}

// Deletes trashed entries for good, each in its own transaction. Every id is
// checked first (an entry, the caller's), so a refused one purges nothing; an
// entry that sits in another selected one goes with it.
export async function purgeNodes(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: Done & {
    ids: readonly string[];
    // Called after each entry's purge has committed, so a caller can record it
    // even when a later entry fails and the call throws.
    onPurged?: (entry: NodeDoc) => Promise<void> | void;
  },
): Promise<{ entries: NodeDoc[]; removed: number }> {
  const nodes = nodesMongo(mongo);
  const selected: NodeDoc[] = [];
  for (const id of new Set(input.ids)) {
    selected.push(await entryOf(nodes, id, input.accountId));
  }
  const entries: NodeDoc[] = [];
  let removed = 0;
  for (const top of topsOf(selected)) {
    const done = await purgeEntry(mongo, core, { ...input, id: top.id });
    entries.push(done.entry);
    removed += done.removed;
    await input.onPurged?.(done.entry);
  }
  return { entries, removed };
}

// Purges everything the caller has in the trash.
export async function emptyTrash(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  input: Done & {
    // Called after each entry's purge has committed (see `purgeNodes`).
    onPurged?: (entry: NodeDoc, removed: number) => Promise<void> | void;
  },
): Promise<{ entries: number; removed: number }> {
  let entries = 0;
  let removed = 0;
  for (;;) {
    const next = await mongo.db.nodes.raw.findOne(
      {
        ownerId: input.accountId,
        trashedAt: { $type: "date" },
        trashRootId: null,
      },
      { projection: { _id: 1 } },
    );
    if (!next) return { entries, removed };
    const done = await purgeEntry(mongo, core, {
      ...input,
      id: next._id.toHexString(),
    });
    entries += 1;
    removed += done.removed;
    await input.onPurged?.(done.entry, done.removed);
  }
}
