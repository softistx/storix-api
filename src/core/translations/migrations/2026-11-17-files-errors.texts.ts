import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "files.errors.key-unknown": {
    en: "This upload cannot be added: it is not in this workspace, or it was already added. Upload the file again.",
    fr: "Ce téléversement ne peut pas être ajouté, car il n’est pas dans cet espace de travail ou a déjà été ajouté. Téléversez à nouveau le fichier.",
  },
};
