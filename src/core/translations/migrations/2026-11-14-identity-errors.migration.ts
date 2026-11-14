import { removeTexts, upsertTexts } from "@alxia/i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-14-identity-errors.texts";

// The messages of the identity module's codes, `identity.errors.*`, in English
// and French (plan §3.13).
export const identityErrors = defineMigration({
  id: "2026-11-14-identity-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
