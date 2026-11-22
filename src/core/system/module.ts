import { defineModule } from "@softistx/alxia-modules";
import type { Resolvers } from "@/generated/graphql/resolvers";
import pkg from "../../../package.json" with { type: "json" };
import { auth, validation } from "./system.errors";
import typeDefs from "./system.graphqls" with { type: "text" };

const resolvers: Resolvers = {
  Query: { version: () => pkg.version },
};

export const system = defineModule({
  name: "system",
  // The shared namespaces, auth and validation (system.errors.ts).
  codes: [...auth, ...validation],
  typeDefs: [typeDefs],
  resolvers,
});
