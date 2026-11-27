import { defineMigration } from "@softistx/mongo/migrations";

// The largest-files index: a database whose indexes are not synced at boot
// (production without MONGO_AUTO_SYNC) builds it here. Keep in step with
// `nodes/models/nodes.model.ts`.
export const nodesLargestIndex = defineMigration({
  id: "2026-11-26-nodes-largest-index",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    // A workspace database with no `nodes` yet is built by the sync.
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const nodes = db.collection("nodes");
    const existing = await nodes.indexes();
    if (existing.some((index) => index.name === "nodes_largest")) return;
    await nodes.createIndex(
      { size: -1, _id: -1 },
      {
        name: "nodes_largest",
        partialFilterExpression: { type: "FILE", trashedAt: { $type: "null" } },
      },
    );
  },
  // The index stays: dropping it would only slow the quotas screen.
  async down() {},
});
