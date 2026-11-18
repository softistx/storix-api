import type { Texts } from "@alxia/i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "identity.errors.current-password-wrong": {
    en: "The current password is wrong.",
    fr: "Le mot de passe actuel est incorrect.",
  },
  "identity.errors.session-not-found": {
    en: "This session does not exist or has already ended.",
    fr: "Cette session n’existe pas ou est déjà terminée.",
  },
};
