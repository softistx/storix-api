import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "identity.errors.invalid-credentials": {
    en: "The e-mail or password is wrong.",
    fr: "L’adresse e-mail ou le mot de passe est incorrect.",
  },
  "identity.errors.email-unverified": {
    en: "Confirm your e-mail address to continue.",
    fr: "Confirmez votre adresse e-mail pour continuer.",
  },
  "identity.errors.token-invalid": {
    en: "This link or code has expired or was already used. Ask for a new one.",
    fr: "Ce lien ou ce code a expiré ou a déjà servi. Demandez-en un nouveau.",
  },
  "identity.errors.second-factor-invalid": {
    en: "The code is not right. Check your authenticator app and try again.",
    fr: "Le code n’est pas bon. Vérifiez votre application d’authentification et réessayez.",
  },
  "identity.errors.second-factor-state": {
    en: "Your second factor changed in the meantime. Reload and try again.",
    fr: "Votre second facteur a changé entre-temps. Rechargez et réessayez.",
  },
  "identity.errors.unavailable": {
    en: "Sign-in is unavailable for a moment. Try again shortly.",
    fr: "La connexion est indisponible un instant. Réessayez bientôt.",
  },
};
