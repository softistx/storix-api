import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "teams.errors.not-found": {
    en: "This team does not exist in the workspace.",
    fr: "Cette équipe n’existe pas dans l’espace de travail.",
  },
  "teams.errors.name-taken": {
    en: "A team with this name already exists in the workspace.",
    fr: "Une équipe porte déjà ce nom dans l’espace de travail.",
  },
  "teams.errors.member-unknown": {
    en: "Some of these people are not members of the workspace.",
    fr: "Certaines de ces personnes ne sont pas membres de l’espace de travail.",
  },
};
