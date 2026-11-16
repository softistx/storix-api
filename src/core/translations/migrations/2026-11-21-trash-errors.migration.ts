import { removeTexts, upsertTexts } from "@alxia/i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-21-trash-errors.texts";

// The message of `trash.errors.not-trashed`, in English and French (plan §3.13).
export const trashErrors = defineMigration({
  id: "2026-11-21-trash-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
