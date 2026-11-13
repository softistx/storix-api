import { defineModule } from "@alxia/modules";
import type { Resolvers } from "@/generated/graphql/resolvers";
import pkg from "../../../package.json" with { type: "json" };
import typeDefs from "./system.graphqls" with { type: "text" };

const resolvers: Resolvers = {
  Query: { version: () => pkg.version },
};

export const system = defineModule({
  name: "system",
  typeDefs: [typeDefs],
  resolvers,
});
