import { defineModule } from "@softistx/alxia-modules";
import { translationMigrations } from "./migrations";
import { translations } from "./translations.collection";
import typeDefs from "./translations.graphqls" with { type: "text" };
import { translationResolvers } from "./translations.resolver";

// Error (and, later, mail) texts in the database, and `Query.errorCatalogue`.
// The collection lives in the core database, shared by every workspace.
export const translationsModule = defineModule({
  name: "translations",
  coreCollections: { translations },
  coreMigrations: translationMigrations,
  typeDefs: [typeDefs],
  resolvers: translationResolvers,
});
