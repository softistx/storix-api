import { defineMigration } from "@softistx/mongo/migrations";

// Crops are stored per focal point (`cropsKeyOf`). A node that already has a
// focal point has its crops under the blob's own key, while `File.cropsKey`
// now names a key of its own: the node's crops are marked pending so the stuck
// sweep queues a crops job that makes them there. A node at the centre keeps
// its crops (same key) and is left alone.
export const nodesCropsRedo = defineMigration({
  id: "2026-11-28-nodes-crops-redo",
  async up({ db }) {
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    await db.collection("nodes").updateMany(
      {
        focalPoint: { $type: "object" },
        blobKey: { $type: "string" },
        trashedAt: null,
      },
      {
        $set: {
          cropsStatus: "PROCESSING",
          renditionsAt: new Date(0),
          renditionRequeues: 0,
        },
      },
    );
  },
  // The crops stay where they are made: nothing to undo.
  async down() {},
});
