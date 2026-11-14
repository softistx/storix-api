import type { Texts } from "../translations.seeds";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  en: {
    "identity.errors.invalid-credentials": "The e-mail or password is wrong.",
    "identity.errors.email-unverified":
      "Confirm your e-mail address to continue.",
    "identity.errors.token-invalid":
      "This link or code has expired or was already used. Ask for a new one.",
    "identity.errors.second-factor-invalid":
      "The code is not right. Check your authenticator app and try again.",
    "identity.errors.second-factor-state":
      "Your second factor changed in the meantime. Reload and try again.",
    "identity.errors.unavailable":
      "Sign-in is unavailable for a moment. Try again shortly.",
  },
  fr: {
    "identity.errors.invalid-credentials":
      "L’adresse e-mail ou le mot de passe est incorrect.",
    "identity.errors.email-unverified":
      "Confirmez votre adresse e-mail pour continuer.",
    "identity.errors.token-invalid":
      "Ce lien ou ce code a expiré ou a déjà servi. Demandez-en un nouveau.",
    "identity.errors.second-factor-invalid":
      "Le code n’est pas bon. Vérifiez votre application d’authentification et réessayez.",
    "identity.errors.second-factor-state":
      "Votre second facteur a changé entre-temps. Rechargez et réessayez.",
    "identity.errors.unavailable":
      "La connexion est indisponible un instant. Réessayez bientôt.",
  },
};
