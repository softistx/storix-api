import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "versions.errors.not-found": {
    en: "This version does not exist. It may have been deleted.",
    fr: "Cette version n’existe pas. Elle a peut-être été supprimée.",
  },
  "versions.errors.is-current": {
    en: "This is the current version. Restore another version first.",
    fr: "C’est la version actuelle. Restaurez d’abord une autre version.",
  },
};
