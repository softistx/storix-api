import { defineModule } from "@softistx/alxia-modules";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { auth, validation } from "@/i18n/codes";
import pkg from "../../../package.json" with { type: "json" };
import typeDefs from "./system.graphqls" with { type: "text" };

const resolvers: Resolvers = {
  Query: { version: () => pkg.version },
};

export const system = defineModule({
  name: "system",
  // The shared namespaces, auth and validation (src/i18n/codes.ts).
  codes: [...auth, ...validation],
  typeDefs: [typeDefs],
  resolvers,
});
