import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { catalogueOfLanguage, errorMessages } from "./translations.load";

const languageValue = (code: string) => (code === "fr" ? "FR" : "EN");

// The error catalogue is public: no guard. `version` and `language` read
// nothing; `messages` is its own field, so a query that selects only `version`
// builds no list.
export const translationResolvers: Resolvers = {
  Query: {
    errorCatalogue: (_, { language }) =>
      catalogueOfLanguage(language?.toLowerCase() ?? i18n.language()),
  },
  ErrorCatalogue: {
    language: ({ language }) => languageValue(language),
    messages: ({ language }) => errorMessages(language),
  },
};
