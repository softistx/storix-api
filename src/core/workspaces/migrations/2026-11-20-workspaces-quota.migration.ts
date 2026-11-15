import { defineMigration } from "@softistx/mongo/migrations";
import { DEFAULT_QUOTA_BYTES } from "../workspaces.collection";

// A workspace made before the quota existed gets the default quota (10 GiB)
// and empty counters. The counters are the reconcile job's to fill
// (`bun run quota:reconcile`): this only makes the document valid, since both
// fields are required. One pipeline sets both, so no step leaves a document
// that the validator refuses.
export const workspacesQuota = defineMigration({
  id: "2026-11-20-workspaces-quota",
  async up({ db, session }) {
    await db.collection("workspaces").updateMany(
      {
        $or: [
          { quotaBytes: { $exists: false } },
          { usage: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            quotaBytes: { $ifNull: ["$quotaBytes", DEFAULT_QUOTA_BYTES] },
            usage: {
              $ifNull: [
                "$usage",
                { bytes: 0, files: 0, versionBytes: 0, trashBytes: 0 },
              ],
            },
          },
        },
      ],
      { ...(session && { session }), bypassDocumentValidation: true },
    );
  },
  // Nothing to undo: the fields stay, harmless to the older build.
  async down() {},
});
