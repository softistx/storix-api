import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "storage.errors.too-large": {
    en: "This file is larger than the {limitMib, number} MiB allowed.",
    fr: "Ce fichier dépasse la taille autorisée de {limitMib, number} Mio.",
  },
  "storage.errors.unsupported-type": {
    en: "This type of file is not accepted here.",
    fr: "Ce type de fichier n’est pas accepté ici.",
  },
  "storage.errors.empty": {
    en: "The file is empty.",
    fr: "Le fichier est vide.",
  },
  "storage.errors.rate-limited": {
    en: "Too many uploads. Try again in {seconds, number} seconds.",
    fr: "Trop d’envois. Réessayez dans {seconds, number} secondes.",
  },
  "storage.errors.unavailable": {
    en: "File storage is not available right now. Try again later.",
    fr: "Le stockage des fichiers n’est pas disponible pour le moment. Réessayez plus tard.",
  },
  "storage.errors.unprocessable": {
    en: "This picture could not be read or resized.",
    fr: "Cette image n’a pas pu être lue ou redimensionnée.",
  },
  "storage.errors.stalled": {
    en: "The upload stopped sending data and was cancelled.",
    fr: "L’envoi a cessé de transmettre des données et a été annulé.",
  },
  "storage.errors.not-found": {
    en: "This file does not exist in the workspace.",
    fr: "Ce fichier n’existe pas dans l’espace de travail.",
  },
  "storage.errors.range-not-satisfiable": {
    en: "The requested byte range lies past the end of the file.",
    fr: "La plage d’octets demandée dépasse la fin du fichier.",
  },
  "storage.errors.interrupted": {
    en: "The upload ended before all of the file arrived.",
    fr: "L’envoi s’est terminé avant que tout le fichier soit arrivé.",
  },
};
