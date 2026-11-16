import type { Texts } from "@alxia/i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "nodes.errors.not-found": {
    en: "This file or folder does not exist.",
    fr: "Ce fichier ou ce dossier n’existe pas.",
  },
  "nodes.errors.name-taken": {
    en: "A file or folder with this name already exists here.",
    fr: "Un fichier ou un dossier porte déjà ce nom ici.",
  },
  "nodes.errors.too-deep": {
    en: "Folders can be nested 16 levels deep at most.",
    fr: "Les dossiers peuvent être imbriqués sur 16 niveaux au plus.",
  },
  "nodes.errors.cycle": {
    en: "A folder cannot be moved into itself or into one of its own folders.",
    fr: "Un dossier ne peut pas être déplacé dans lui-même ni dans l’un de ses sous-dossiers.",
  },
  "nodes.errors.conflict": {
    en: "This item was changed by someone else. Reload it and try again.",
    fr: "Cet élément a été modifié entre-temps. Rechargez-le et réessayez.",
  },
  "nodes.errors.not-a-folder": {
    en: "The destination is not a folder.",
    fr: "La destination n’est pas un dossier.",
  },
  "nodes.errors.move-too-large": {
    en: "This folder holds too many items to be moved at once.",
    fr: "Ce dossier contient trop d’éléments pour être déplacé en une fois.",
  },
  "nodes.errors.root-locked": {
    en: "A root folder cannot be renamed or moved.",
    fr: "Un dossier racine ne peut être ni renommé ni déplacé.",
  },
};
