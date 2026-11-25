import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-24-shares-errors.texts";

// The messages of the `shares` codes: `not-found`, `principal-unknown`,
// `already-shared` and `owner-only`.
export const sharesErrors = defineMigration({
  id: "2026-11-24-shares-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
