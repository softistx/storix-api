import { Glob } from "bun";

// Keeps CONTEXT.md's "Error codes" current: every code the API can answer is
// declared with `defineCodes("<module>", [slugs])`. This lists them from the
// source and fails, naming each, when CONTEXT.md does not.
//
// A code is documented when its row (a line starting with
// "| `<module>.errors.`") holds the full code or the slug in backticks, which
// covers the grouped forms (`a` / `b`).
//
//   bun run context:check
const root = new URL("../..", import.meta.url).pathname;
const call = /defineCodes\(\s*"([a-z0-9-]+)"\s*,\s*\[([^\]]*)\]/g;

export function declaredCodes(source: string): string[] {
  return [...source.matchAll(call)].flatMap(([, module, slugs]) =>
    [...(slugs ?? "").matchAll(/"([a-z0-9-]+)"/g)].map(
      ([, slug]) => `${module}.errors.${slug}`,
    ),
  );
}

export function missingCodes(codes: string[], context: string): string[] {
  const rows = context.split("\n").filter((line) => line.startsWith("| `"));
  return codes.filter((code) => {
    const [module = "", slug = ""] = code.split(".errors.");
    return !rows
      .filter((row) => row.startsWith(`| \`${module}.errors.`))
      .some(
        (row) => row.includes(`\`${code}\``) || row.includes(`\`${slug}\``),
      );
  });
}

if (import.meta.main) {
  const contextFile = Bun.file(`${root}CONTEXT.md`);
  if (!(await contextFile.exists())) {
    console.error("CONTEXT.md is missing");
    process.exit(1);
  }
  const codes: string[] = [];
  for await (const file of new Glob("src/**/*.ts").scan({ cwd: root })) {
    if (file.endsWith(".spec.ts")) continue;
    codes.push(...declaredCodes(await Bun.file(`${root}${file}`).text()));
  }
  const missing = missingCodes(
    [...new Set(codes)].sort(),
    await contextFile.text(),
  );
  if (missing.length > 0) {
    console.error(
      `CONTEXT.md "Error codes" lacks ${missing.length} code(s):\n${missing.map((c) => `  ${c}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`CONTEXT.md lists all ${new Set(codes).size} error codes`);
}
