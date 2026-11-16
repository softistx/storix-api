import { defineMigration } from "@softistx/mongo/migrations";

// The trash's indexes (slice A17): a database whose indexes are not synced at
// boot (production without MONGO_AUTO_SYNC) builds them here. A database that
// already has them (synced at boot) is left alone. Keep in step with
// `nodes.collection.ts`.
const TRASH = [
  {
    name: "nodes_trash",
    key: { ownerId: 1, trashedAt: -1, _id: -1 },
    partialFilterExpression: { trashedAt: { $type: "date" } },
  },
  {
    name: "nodes_trashed_at",
    key: { trashedAt: 1 },
    partialFilterExpression: { trashedAt: { $type: "date" } },
  },
  {
    name: "nodes_trash_root",
    key: { trashRootId: 1 },
    partialFilterExpression: { trashRootId: { $type: "objectId" } },
  },
] as const;

export const nodesTrashIndexes = defineMigration({
  id: "2026-11-21-nodes-trash-indexes",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    // A workspace database with no `nodes` yet is built by the sync.
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const nodes = db.collection("nodes");
    const existing = await nodes.indexes();
    for (const { name, key, partialFilterExpression } of TRASH) {
      if (existing.some((index) => index.name === name)) continue;
      await nodes.createIndex(key, { name, partialFilterExpression });
    }
  },
  // The indexes stay: dropping them would only slow the trash.
  async down() {},
});
