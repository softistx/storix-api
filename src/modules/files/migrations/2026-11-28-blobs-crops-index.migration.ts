import { defineMigration } from "@softistx/mongo/migrations";

// The index the read check and the sweep use to map a focal point's crops key
// back to its blob: a database whose indexes are not synced at boot builds it
// here. Keep in step with `models/files.model.ts`. `crops` needs no backfill:
// a blob without it has only the crops under its own key.
export const blobsCropsIndex = defineMigration({
  id: "2026-11-28-blobs-crops-index",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    if ((await db.listCollections({ name: "blobs" }).toArray()).length === 0) {
      return;
    }
    const blobs = db.collection("blobs");
    const existing = await blobs.indexes();
    if (existing.some((index) => index.name === "blobs_crops")) return;
    await blobs.createIndex({ crops: 1 }, { name: "blobs_crops" });
  },
  // The index stays: dropping it would only slow the read check.
  async down() {},
});
