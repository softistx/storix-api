import { createI18n } from "@softistx/alxia-i18n";
import type { ErrorCode } from "./codes";

// English is the product's default language and the last step of every chain.
export const FALLBACK_LANGUAGE = "en";
export const LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

// The request's language: `Accept-Language` first, then the `lang` query, then
// the `language` cookie, among the shipped languages. `i18n.t()` translates in
// it anywhere in the request, an error's message included. The catalogues are
// the database's (`loadTranslations`, src/core/translations): until they are
// loaded `t` answers the key.
export const i18n = createI18n<ErrorCode, Language>({
  languages: [...LANGUAGES],
  fallback: FALLBACK_LANGUAGE,
  order: ["header", "query", "cookie"],
});
