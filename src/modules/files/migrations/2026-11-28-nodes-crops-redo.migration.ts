import { defineMigration } from "@softistx/mongo/migrations";

// Crops are stored per focal point (`cropsKeyOf`). The crops of a blob that a
// node holds at a focal point were made under the blob's own key, mixing the
// points of its copies: every node of such a blob (the centre copies too,
// trashed ones included) is marked pending, so the stuck sweep queues a crops
// job per point. `cropsKey` stays unset: the crops already stored keep serving
// under the blob's key until the new ones settle.
export const nodesCropsRedo = defineMigration({
  id: "2026-11-28-nodes-crops-redo",
  async up({ db }) {
    if ((await db.listCollections({ name: "nodes" }).toArray()).length === 0) {
      return;
    }
    const nodes = db.collection("nodes");
    const keys = await nodes.distinct("blobKey", {
      focalPoint: { $type: "object" },
      blobKey: { $type: "string" },
    });
    if (keys.length === 0) return;
    await nodes.updateMany(
      { blobKey: { $in: keys } },
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
