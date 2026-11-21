import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-15-invitations-errors.texts";

// The messages of the invitations module's codes, `invitations.errors.*`, in
// English and French (plan §3.13).
export const invitationsErrors = defineMigration({
  id: "2026-11-15-invitations-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
