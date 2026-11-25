import { removeTexts, upsertTexts } from "@softistx/alxia-i18n";
import { defineMigration } from "@softistx/mongo/migrations";
import { textStore } from "../translations.store";
import { texts } from "./2026-11-25-notifications-mail.texts";

// The texts of the notification mails: a share, a role change and a quota
// threshold, each with its subject and its body.
export const notificationsMail = defineMigration({
  id: "2026-11-25-notifications-mail",
  async up({ db, session }) {
    await upsertTexts(textStore(db, session), texts);
  },
  async down({ db, session }) {
    await removeTexts(textStore(db, session), texts);
  },
});
