import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "files.errors.not-a-file": {
    en: "Only a file has tags and metadata. Choose a file, not a folder.",
    fr: "Seul un fichier a des étiquettes et des métadonnées. Choisissez un fichier, pas un dossier.",
  },
  "files.errors.copy-too-large": {
    en: "This folder holds too many items to copy at once. Copy part of it, or copy it in several steps.",
    fr: "Ce dossier contient trop d’éléments pour être copié d’un seul coup. Copiez-en une partie, ou copiez-le en plusieurs fois.",
  },
};
