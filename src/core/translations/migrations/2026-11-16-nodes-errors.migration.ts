import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-16-nodes-errors.texts";

// The messages of the nodes module's codes, `nodes.errors.*`, in
// English and French (plan §3.13).
export const nodesErrors = defineMigration({
  id: "2026-11-16-nodes-errors",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
