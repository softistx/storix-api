import { removeTexts, upsertTexts } from "@alxia/i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-13-auth-validation-errors.texts";

// The messages of the shared namespaces, `auth.errors.*` and
// `validation.errors.*`, in English and French (plan §3.13). Each later slice
// that declares codes adds a migration like this one, named for its module.
export const authValidationErrors = defineMigration({
  id: "2026-11-13-auth-validation-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
