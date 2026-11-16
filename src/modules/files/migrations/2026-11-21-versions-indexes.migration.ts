import { defineMigration } from "@softistx/mongo/migrations";

// The versions' indexes (slice E3): a database whose indexes are not synced at
// boot (production without MONGO_AUTO_SYNC) builds them here. A database that
// already has them (synced at boot) is left alone. Keep in step with
// `versions` in `files.collection.ts`.
const VERSIONS = [
  { name: "versions_number", key: { fileId: 1, number: 1 }, unique: true },
  { name: "versions_blob", key: { blobKey: 1 }, unique: false },
] as const;

export const versionsIndexes = defineMigration({
  id: "2026-11-21-versions-indexes",
  // An index build cannot run in a transaction.
  transaction: false,
  async up({ db }) {
    // A workspace database with no `versions` yet is built by the sync.
    if (
      (await db.listCollections({ name: "versions" }).toArray()).length === 0
    ) {
      return;
    }
    const versions = db.collection("versions");
    const existing = await versions.indexes();
    for (const { name, key, unique } of VERSIONS) {
      if (existing.some((index) => index.name === name)) continue;
      await versions.createIndex(key, { name, unique });
    }
  },
  // The indexes stay: dropping them would only slow the versions.
  async down() {},
});
