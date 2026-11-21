import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "auth.errors.unauthenticated": {
    en: "Sign in to continue.",
    fr: "Connectez-vous pour continuer.",
  },
  "auth.errors.forbidden": {
    en: "You are not allowed to do this.",
    fr: "Vous n’avez pas le droit de faire cela.",
  },
  "auth.errors.step-up-required": {
    en: "Confirm your identity again to continue.",
    fr: "Confirmez de nouveau votre identité pour continuer.",
  },
  "auth.errors.second-factor-required": {
    en: "Enter your second-factor code to continue.",
    fr: "Saisissez votre code de second facteur pour continuer.",
  },
  "auth.errors.rate-limited": {
    en: "Too many attempts. Try again in {minutes, plural, one {# minute} other {# minutes}}.",
    fr: "Trop de tentatives. Réessayez dans {minutes, plural, one {# minute} other {# minutes}}.",
  },
  "auth.errors.api-key-not-accepted": {
    en: "An API key cannot do this. Sign in with an account.",
    fr: "Une clé d’API ne peut pas faire cela. Connectez-vous avec un compte.",
  },
  "auth.errors.client-header-required": {
    en: "This request must come from a storix client.",
    fr: "Cette requête doit provenir d’un client storix.",
  },
  "validation.errors.invalid-input": {
    en: "Some fields are not valid.",
    fr: "Certains champs ne sont pas valides.",
  },
  "validation.errors.invalid": {
    en: "This value is not valid.",
    fr: "Cette valeur n’est pas valide.",
  },
  "validation.errors.out-of-range": {
    en: "This value is outside the allowed range.",
    fr: "Cette valeur est en dehors des limites autorisées.",
  },
  "validation.errors.invalid-cursor": {
    en: "The page cursor is not valid. Start again from the first page.",
    fr: "Le curseur de page n’est pas valide. Recommencez à la première page.",
  },
  "validation.errors.invalid-filter": {
    en: "This filter is not valid.",
    fr: "Ce filtre n’est pas valide.",
  },
  "validation.errors.too-short": {
    en: "This value is too short.",
    fr: "Cette valeur est trop courte.",
  },
  "validation.errors.too-long": {
    en: "This value is too long.",
    fr: "Cette valeur est trop longue.",
  },
  "validation.errors.too-few": {
    en: "There are too few items.",
    fr: "Il y a trop peu d’éléments.",
  },
  "validation.errors.too-many": {
    en: "There are too many items.",
    fr: "Il y a trop d’éléments.",
  },
  "validation.errors.invalid-format": {
    en: "This value does not have the right format.",
    fr: "Cette valeur n’a pas le bon format.",
  },
};
