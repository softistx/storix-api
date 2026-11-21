import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-22-invitations-states-errors.texts";

// The messages of the invitation codes that tell why a code cannot be used:
// `invitations.errors.expired`, `already-accepted` and `revoked`.
export const invitationsStatesErrors = defineMigration({
  id: "2026-11-22-invitations-states-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
