import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-14-workspaces-errors.texts";

// The messages of the workspaces and members modules' codes, `workspaces.errors.*` and `members.errors.*`, in English
// and French (plan §3.13).
export const workspacesErrors = defineMigration({
  id: "2026-11-14-workspaces-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
