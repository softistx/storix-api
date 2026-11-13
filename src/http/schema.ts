import { freshPerMutation } from "@alxia/graphql";
import { type Module, typeDefsOf } from "@alxia/modules";
import { mergeResolvers, mergeTypeDefs } from "@graphql-tools/merge";
import { scalarResolvers, scalarTypeDefs } from "@nxgt/graphql-scalars";
import { constraintTypeDefs, withValidation } from "@nxgt/graphql-validation";
import { createSchema } from "graphql-yoga";
import { modules } from "../modules/registry";
import type { Context } from "./context";

// The schema of a list of modules: their SDL (`typeDefs`, one string per file,
// each may declare its own `type Query`) merged with the scalars and
// `@constraint`, their resolvers merged, each root mutation field starting
// with an empty per-request cache (`freshPerMutation`). Nothing is found by a
// glob: a module that is not in src/modules/registry.ts is not in the schema.
// The list is a parameter so a spec can build the schema of a sample module.
export function schemaOf(list: readonly Module[]) {
  return withValidation(
    createSchema<Context>({
      typeDefs: mergeTypeDefs([
        scalarTypeDefs,
        constraintTypeDefs,
        ...typeDefsOf(list),
      ]),
      resolvers: [
        scalarResolvers,
        freshPerMutation(
          mergeResolvers(
            list.flatMap((module) =>
              module.resolvers ? [module.resolvers] : [],
            ) as never,
          ),
        ),
      ] as never,
    }),
  );
}

export const schema = schemaOf(modules);
