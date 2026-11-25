import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "notifications.errors.not-found": {
    en: "This notification does not exist.",
    fr: "Cette notification n’existe pas.",
  },
};
