import type { Texts } from "@alxia/i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "workspaces.errors.not-found": {
    en: "This workspace does not exist, or you are not a member of it.",
    fr: "Cet espace de travail n’existe pas, ou vous n’en êtes pas membre.",
  },
  "workspaces.errors.workspace-required": {
    en: "Choose a workspace to continue.",
    fr: "Choisissez un espace de travail pour continuer.",
  },
  "workspaces.errors.slug-taken": {
    en: "This workspace address is already taken. Choose another one.",
    fr: "Cette adresse d’espace de travail est déjà prise. Choisissez-en une autre.",
  },
  "workspaces.errors.last-owner": {
    en: "A workspace needs at least one owner. Make someone else an owner first.",
    fr: "Un espace de travail a besoin d’au moins un propriétaire. Nommez d’abord un autre propriétaire.",
  },
  "members.errors.not-found": {
    en: "This member does not exist in the workspace.",
    fr: "Ce membre n’existe pas dans l’espace de travail.",
  },
};
