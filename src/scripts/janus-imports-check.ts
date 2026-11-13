import { Glob } from "bun";

// The identity seam (docs/plan.md §3.11): every module stores `accountId` as
// an opaque string and never imports a janus package. Only the identity port's
// adapter (`src/core/identity/**`) and `src/config/auth.ts` may. This lists
// the files under src/ (specs included) that import `@softistx/janus*`
// elsewhere and fails, naming each.
//
//   bun run deps:check
const root = new URL("../..", import.meta.url).pathname;

const allowed = [/^src\/core\/identity\//, /^src\/config\/auth\.ts$/];
const janus =
  /(?:from|import)\s*\(?\s*["']@softistx\/janus(?:-[a-z]+)*(?:\/[^"']*)?["']/;

export function janusImporters(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(
      ([file, source]) =>
        janus.test(source) && !allowed.some((pattern) => pattern.test(file)),
    )
    .map(([file]) => file)
    .sort();
}

if (import.meta.main) {
  const files: Record<string, string> = {};
  for await (const file of new Glob("src/**/*.ts").scan({ cwd: root })) {
    // Its own spec holds import lines as fixtures.
    if (file === "src/scripts/janus-imports-check.spec.ts") continue;
    files[file] = await Bun.file(`${root}${file}`).text();
  }
  const offenders = janusImporters(files);
  if (offenders.length > 0) {
    console.error(
      `${offenders.length} file(s) import a janus package outside the identity seam (src/core/identity, src/config/auth.ts):\n${offenders.map((f) => `  ${f}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("no janus import outside the identity seam");
}
