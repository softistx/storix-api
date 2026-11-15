import type { CodegenConfig } from "@graphql-codegen/cli";
import { codegenScalars } from "@nxgt/graphql-scalars";

// `bun run generate` writes, from every src/**/*.graphqls and the SDL of
// @nxgt/graphql-scalars and @constraint (generated/graphql/):
// - src/generated/graphql/resolvers.ts: the schema's types and `Resolvers`,
//   whose context is the app's own (`Context`, src/http/context.ts). A module maps
//   a type to the document its collection stores with `mappers`.
// - src/generated/graphql/zod.ts: the Zod schemas of the inputs.
const janusSdl = "node_modules/@softistx/janus-graphql/graphql";
const schema = [
  "src/**/*.graphqls",
  "generated/graphql/**/*.graphqls",
  // The invitation fields and the directives they declare, as janus-graphql
  // ships them (src/core/invitations serves them).
  `${janusSdl}/janus.graphqls`,
  `${janusSdl}/janus-invitations.graphqls`,
];

const config: CodegenConfig = {
  schema,
  ignoreNoDocuments: true,
  generates: {
    "src/generated/graphql/resolvers.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        contextType: "@/http/context#Context",
        scalars: codegenScalars,
        useTypeImports: true,
        useIndexSignature: true,
        enumsAsTypes: true,
        mappers: {
          ErrorCatalogue: "@/core/translations/translations.load#CatalogueView",
          // `renditions` is the files module's field: the parent is the view
          // `nodeView` makes, which holds what it reads.
          File: "@/modules/nodes/public#FileNode",
        },
      },
    },
    "src/generated/graphql/zod.ts": {
      plugins: ["@nxgt/graphql-codegen-zod"],
      config: { scalarSchemas: "@nxgt/graphql-scalars" },
    },
  },
};

export default config;
