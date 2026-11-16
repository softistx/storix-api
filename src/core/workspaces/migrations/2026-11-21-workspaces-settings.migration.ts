import { defineMigration } from "@softistx/mongo/migrations";

// A workspace made before the settings existed gets the defaults, frozen here
// on purpose: they must not change meaning if the live defaults change later.
export const workspacesSettings = defineMigration({
  id: "2026-11-21-workspaces-settings",
  async up({ db, session }) {
    await db.collection("workspaces").updateMany(
      { settings: { $exists: false } },
      {
        $set: {
          settings: { trashDays: 30, versionsMax: 20, versionsDays: 90 },
        },
      },
      { ...(session && { session }), bypassDocumentValidation: true },
    );
  },
  // Nothing to undo: the field stays, harmless to the older build.
  async down() {},
});
