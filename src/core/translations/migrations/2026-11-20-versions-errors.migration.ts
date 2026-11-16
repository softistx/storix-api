import { removeTexts, upsertTexts } from "@alxia/i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-20-versions-errors.texts";

// The messages of `versions.errors.not-found` and `versions.errors.is-current`, in English and French (plan §3.13).
export const versionsErrors = defineMigration({
  id: "2026-11-20-versions-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
