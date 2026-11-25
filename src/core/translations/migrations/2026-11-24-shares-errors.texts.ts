import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "shares.errors.not-found": {
    en: "This item or this share does not exist, or you cannot access it.",
    fr: "Cet élément ou ce partage n’existe pas, ou vous n’y avez pas accès.",
  },
  "shares.errors.principal-unknown": {
    en: "This member or team does not exist in the workspace.",
    fr: "Ce membre ou cette équipe n’existe pas dans l’espace de travail.",
  },
  "shares.errors.already-shared": {
    en: "This item is already shared with them. Change their role instead.",
    fr: "Cet élément est déjà partagé avec eux. Modifiez plutôt leur rôle.",
  },
  "shares.errors.owner-only": {
    en: "Only the owner or an editor can share this item.",
    fr: "Seuls le propriétaire ou un éditeur peuvent partager cet élément.",
  },
};
