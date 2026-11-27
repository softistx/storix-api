import { defineMigration } from "@softistx/mongo/migrations";

// The index the stuck sweep scans for focal-point crops still `PROCESSING`: a
// database whose indexes are not synced at boot (production without
// MONGO_AUTO_SYNC) builds it here. Keep in step with
// `nodes/models/nodes.model.ts`. `cropsStatus` itself needs no backfill: a
// node without it reads as its file's status.
export const nodesCropsIndex = defineMigration({
  id: "2026-11-27-nodes-crops-index",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    // A workspace database with no `nodes` yet is built by the sync.
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const nodes = db.collection("nodes");
    const existing = await nodes.indexes();
    if (existing.some((index) => index.name === "nodes_crops_processing")) {
      return;
    }
    await nodes.createIndex(
      { renditionsAt: 1 },
      {
        name: "nodes_crops_processing",
        partialFilterExpression: { cropsStatus: "PROCESSING" },
      },
    );
  },
  // The index stays: dropping it would only slow the sweep.
  async down() {},
});
