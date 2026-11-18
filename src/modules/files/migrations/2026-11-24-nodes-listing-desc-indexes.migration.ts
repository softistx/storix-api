import { defineMigration } from "@softistx/mongo/migrations";

// The date sort and the descending sorts of the listing read an index (plan
// §3.3): `nodes_listing_date` gets the name collation (the sort on `type` uses
// it, and an index without it sorts in memory), and each field has a
// descending twin, since an index is read backwards as a whole and folders
// stay first. `nodes_processing` serves the sweep's scan for files stuck
// `PROCESSING`. A database whose indexes are not synced at boot builds them
// here; one that has them is left alone. Keep in step with
// `nodes.collection.ts`. It lives in the files module only for its place in the
// list: the runner takes the modules in registry order, nodes first, and a new
// id must come after `2026-11-21-versions-indexes`, which the files module
// lists.
const LISTING = [
  {
    name: "nodes_listing_date",
    key: { parentId: 1, type: -1, updatedAt: 1, _id: 1 },
  },
  {
    name: "nodes_listing_desc",
    key: { parentId: 1, type: -1, name: -1, _id: -1 },
  },
  {
    name: "nodes_listing_date_desc",
    key: { parentId: 1, type: -1, updatedAt: -1, _id: -1 },
  },
  {
    name: "nodes_listing_size_desc",
    key: { parentId: 1, type: -1, size: -1, name: -1, _id: -1 },
  },
  {
    name: "nodes_listing_kind_desc",
    key: { parentId: 1, type: -1, family: -1, name: -1, _id: -1 },
  },
] as const;

// Frozen on purpose, as in 2026-11-15-nodes-listing-collation.
const collation = { locale: "en", strength: 2 } as const;

export const nodesListingDescIndexes = defineMigration({
  id: "2026-11-24-nodes-listing-desc-indexes",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    // A workspace database with no `nodes` yet is built by the sync.
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const nodes = db.collection("nodes");
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
    if (!existing.some((index) => index.name === "nodes_processing")) {
      await nodes.createIndex(
        { updatedAt: 1 },
        {
          name: "nodes_processing",
          partialFilterExpression: { status: "PROCESSING" },
        },
      );
    }
  },
  // The indexes stay: dropping them would only slow the listings.
  async down() {},
});
