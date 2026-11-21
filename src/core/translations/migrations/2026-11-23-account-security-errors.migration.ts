import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-23-account-security-errors.texts";

// The messages of the account security codes: `identity.errors.current-password-wrong`
// and `identity.errors.session-not-found`.
export const accountSecurityErrors = defineMigration({
  id: "2026-11-23-account-security-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
