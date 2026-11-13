import { printSchemaWithDirectives } from "@graphql-tools/utils";
import { lexicographicSortSchema } from "graphql";

// Writes the schema the server runs, every module's SDL merged with the
// scalars and @constraint, sorted, with every directive usage kept (graphql-js
// printSchema drops them, and storix-ui generates its form limits from them), to schema.graphql at the repository root:
// the committed contract storix-ui generates its client from. With
// --check, writes nothing and exits 1 when schema.graphql is stale, which
// `bun run verify` runs.
// Building the schema imports src/config/env.ts, which requires MONGO_URI, though printing
// opens no connection: a placeholder stands in so that CI and a fresh checkout need no .env.
Bun.env["MONGO_URI"] ??= "mongodb://placeholder.invalid:27017";
const { schema } = await import("@/http/schema");

const path = `${import.meta.dir}/../../schema.graphql`;
const printed = `${printSchemaWithDirectives(lexicographicSortSchema(schema))}\n`;

if (process.argv.includes("--check")) {
  const file = Bun.file(path);
  const current = (await file.exists()) ? await file.text() : "";
  if (current !== printed) {
    console.error(
      "schema.graphql is stale: run `bun run schema:print` and commit it",
    );
    process.exit(1);
  }
} else {
  await Bun.write(path, printed);
}
