import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "quotas.errors.exceeded": {
    en: "This workspace does not have enough storage left for this file. Free some space or ask an administrator to raise the limit.",
    fr: "Cet espace de travail n’a plus assez de stockage pour ce fichier. Libérez de la place ou demandez à un administrateur d’augmenter la limite.",
  },
};
