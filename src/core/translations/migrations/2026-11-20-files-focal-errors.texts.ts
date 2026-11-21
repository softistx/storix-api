import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. ICU messages; French uses ’ so that no
// apostrophe quotes a brace.
export const texts: Texts = {
  "files.errors.not-renderable": {
    en: "Only a JPEG, PNG or WebP picture has a focal point. Choose a picture.",
    fr: "Seule une image JPEG, PNG ou WebP a un point focal. Choisissez une image.",
  },
  "files.errors.invalid-focal": {
    en: "The focal point must give x and y as numbers from 0 to 1.",
    fr: "Le point focal doit donner x et y sous forme de nombres de 0 à 1.",
  },
};
