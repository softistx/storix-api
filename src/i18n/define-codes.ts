export type Code<
  Module extends string,
  Slug extends string,
> = `${Module}.errors.${Slug}`;

// A module's error codes, `<module>.errors.<slug>`: the inventory in code that
// `ErrorCode` (codes.ts) gathers. The API's contract is the code; its message
// in each language is data (the `translations` collection, written by a
// migration). `bun run context:check` reads the calls of this function, so
// the module and the slugs are written as literals: `defineCodes("nodes", ["not-found"])`.
export function defineCodes<
  const Module extends string,
  const Slugs extends readonly string[],
>(module: Module, slugs: Slugs): readonly Code<Module, Slugs[number]>[] {
  return slugs.map((slug) => `${module}.errors.${slug}` as const);
}
