import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-17-files-errors.texts";

// The messages of the files codes, `files.errors.*`, in English and French
// (plan §3.13).
export const filesErrors = defineMigration({
  id: "2026-11-17-files-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
