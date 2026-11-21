import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "invitations.errors.expired": {
    en: "This invitation has expired. Ask for a new one.",
    fr: "Cette invitation a expiré. Demandez-en une nouvelle.",
  },
  "invitations.errors.already-accepted": {
    en: "This invitation was already accepted. Sign in to continue.",
    fr: "Cette invitation a déjà été acceptée. Connectez-vous pour continuer.",
  },
  "invitations.errors.revoked": {
    en: "This invitation was withdrawn. Ask for a new one.",
    fr: "Cette invitation a été retirée. Demandez-en une nouvelle.",
  },
};
