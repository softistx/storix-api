import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { languageValue, loaded } from "./translations.utils";

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
