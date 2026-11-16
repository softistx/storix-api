import type { Texts } from "@alxia/i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "trash.errors.not-trashed": {
    en: "This item is not in the trash.",
    fr: "Cet élément n’est pas dans la corbeille.",
  },
};
