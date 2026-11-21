import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "invitations.errors.not-found": {
    en: "This invitation does not exist in the workspace.",
    fr: "Cette invitation n’existe pas dans l’espace de travail.",
  },
  "invitations.errors.invalid": {
    en: "This invitation link is not valid any more. Ask for a new invitation.",
    fr: "Ce lien d’invitation n’est plus valide. Demandez une nouvelle invitation.",
  },
  "invitations.errors.not-pending": {
    en: "This invitation was already accepted or revoked.",
    fr: "Cette invitation a déjà été acceptée ou révoquée.",
  },
  "invitations.errors.limit": {
    en: "The workspace has too many pending invitations. Revoke some, or wait for them to be accepted.",
    fr: "L’espace de travail a trop d’invitations en attente. Révoquez-en, ou attendez qu’elles soient acceptées.",
  },
  "invitations.errors.already-member": {
    en: "This person is already a member of the workspace.",
    fr: "Cette personne est déjà membre de l’espace de travail.",
  },
  "invitations.errors.password-required": {
    en: "Choose a password to create your account.",
    fr: "Choisissez un mot de passe pour créer votre compte.",
  },
};
