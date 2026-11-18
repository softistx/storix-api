import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { i18n } from "@/i18n";
import type { Translations } from "./translations.load";

// The translations `boot` loaded, which the app hands to every request.
function loaded(ctx: Context): Translations {
  if (!ctx.translations) throw new Error("the translations are not loaded");
  return ctx.translations;
}

const languageValue = (code: string) => (code === "fr" ? "FR" : "EN");

// The error catalogue is public: no guard. `version` and `language` read
// nothing; `messages` is its own field, so a query that selects only `version`
// builds no list.
export const translationResolvers: Resolvers = {
  Query: {
    errorCatalogue: (_, { language }, ctx) =>
      loaded(ctx).catalogueOfLanguage(
        language?.toLowerCase() ?? i18n.language(),
      ),
  },
  ErrorCatalogue: {
    language: ({ language }) => languageValue(language),
    messages: ({ language }, _, ctx) => loaded(ctx).errorMessages(language),
  },
};
