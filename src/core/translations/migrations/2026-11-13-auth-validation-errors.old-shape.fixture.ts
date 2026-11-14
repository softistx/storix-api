// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
// The shape of this frozen migration text at 485289c, before it was reshaped to
// { key: { en, fr } }: the fixture its spec compares the current rows with.
export const oldShape: Record<"en" | "fr", Record<string, string>> = {
  en: {
    "auth.errors.unauthenticated": "Sign in to continue.",
    "auth.errors.forbidden": "You are not allowed to do this.",
    "auth.errors.step-up-required": "Confirm your identity again to continue.",
    "auth.errors.second-factor-required":
      "Enter your second-factor code to continue.",
    "auth.errors.rate-limited":
      "Too many attempts. Try again in {minutes, plural, one {# minute} other {# minutes}}.",
    "auth.errors.api-key-not-accepted":
      "An API key cannot do this. Sign in with an account.",
    "auth.errors.client-header-required":
      "This request must come from a storix client.",
    "validation.errors.invalid-input": "Some fields are not valid.",
    "validation.errors.invalid": "This value is not valid.",
    "validation.errors.out-of-range":
      "This value is outside the allowed range.",
    "validation.errors.invalid-cursor":
      "The page cursor is not valid. Start again from the first page.",
    "validation.errors.invalid-filter": "This filter is not valid.",
    "validation.errors.too-short": "This value is too short.",
    "validation.errors.too-long": "This value is too long.",
    "validation.errors.too-few": "There are too few items.",
    "validation.errors.too-many": "There are too many items.",
    "validation.errors.invalid-format":
      "This value does not have the right format.",
  },
  fr: {
    "auth.errors.unauthenticated": "Connectez-vous pour continuer.",
    "auth.errors.forbidden": "Vous n’avez pas le droit de faire cela.",
    "auth.errors.step-up-required":
      "Confirmez de nouveau votre identité pour continuer.",
    "auth.errors.second-factor-required":
      "Saisissez votre code de second facteur pour continuer.",
    "auth.errors.rate-limited":
      "Trop de tentatives. Réessayez dans {minutes, plural, one {# minute} other {# minutes}}.",
    "auth.errors.api-key-not-accepted":
      "Une clé d’API ne peut pas faire cela. Connectez-vous avec un compte.",
    "auth.errors.client-header-required":
      "Cette requête doit provenir d’un client storix.",
    "validation.errors.invalid-input": "Certains champs ne sont pas valides.",
    "validation.errors.invalid": "Cette valeur n’est pas valide.",
    "validation.errors.out-of-range":
      "Cette valeur est en dehors des limites autorisées.",
    "validation.errors.invalid-cursor":
      "Le curseur de page n’est pas valide. Recommencez à la première page.",
    "validation.errors.invalid-filter": "Ce filtre n’est pas valide.",
    "validation.errors.too-short": "Cette valeur est trop courte.",
    "validation.errors.too-long": "Cette valeur est trop longue.",
    "validation.errors.too-few": "Il y a trop peu d’éléments.",
    "validation.errors.too-many": "Il y a trop d’éléments.",
    "validation.errors.invalid-format": "Cette valeur n’a pas le bon format.",
  },
};
