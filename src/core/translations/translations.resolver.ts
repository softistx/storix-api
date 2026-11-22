import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { languageValue, loaded } from "./translations.utils";

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
