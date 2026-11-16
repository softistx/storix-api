import { defineMigration } from "@softistx/mongo/migrations";

// The listing indexes that end in the name carry the name collation (plan
// §3.3), and `nodes_listing` sorts folders first like the others. MongoDB
// cannot change an index in place: a database whose indexes are not synced at
// boot (production without MONGO_AUTO_SYNC) drops and builds them here. A
// database that already has them (synced at boot) is left alone.
const LISTING = [
  { name: "nodes_listing", key: { parentId: 1, type: -1, name: 1, _id: 1 } },
  {
    name: "nodes_listing_size",
    key: { parentId: 1, type: -1, size: 1, name: 1, _id: 1 },
  },
  {
    name: "nodes_listing_kind",
    key: { parentId: 1, type: -1, family: 1, name: 1, _id: 1 },
  },
] as const;

// Frozen on purpose: a migration keeps the value it was written for, even if
// NAME_COLLATION changes later (a new migration would then rebuild again).
const collation = { locale: "en", strength: 2 } as const;

export const nodesListingCollation = defineMigration({
  id: "2026-11-15-nodes-listing-collation",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    const nodes = db.collection("nodes");
    // A workspace database that has no `nodes` yet is built with the right
    // indexes by the sync.
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const existing = await nodes.indexes();
    for (const { name, key } of LISTING) {
      const found = existing.find((index) => index.name === name);
      const current =
        found !== undefined &&
        found.collation?.["locale"] === collation.locale &&
        found.collation?.["strength"] === collation.strength &&
        JSON.stringify(found.key) === JSON.stringify(key);
      if (current) continue;
      if (found) await nodes.dropIndex(name);
      await nodes.createIndex(key, { name, collation });
    }
  },
  // The older build's indexes are rebuilt by its own sync.
  async down() {},
});
