import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-20-files-focal-errors.texts";

// The messages of `files.errors.not-renderable` and `files.errors.invalid-focal`, in English and French (plan §3.13).
export const filesFocalErrors = defineMigration({
  id: "2026-11-20-files-focal-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
