import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";

// One text of one language: an error message, keyed by its code. `text` is an
// ICU message (`{minutes, plural, one {# minute} other {# minutes}}`). Rows are
// written by data migrations alone (src/core/translations/migrations) and
// read at startup (`loadTranslations`); nothing updates one from a request.
export const translations = defineCollection({
  name: "translations",
  schema: z.object({
    _id: id(),
    code: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/),
    language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
    text: z.string().min(1),
  }),
  timestamps: true,
  indexes: [
    {
      key: { code: 1, language: 1 },
      unique: true,
      name: "translations_code_language_unique",
    },
  ],
});
