/**
 * Picks the specs a pull request has to run: the specs that are, or import
 * (transitively), a file the diff touched. Anything the import graph cannot
 * see (root config, lockfile, the test preload, non-TypeScript
 * files under src/, test/ or scripts/) selects the whole suite. The full `verify` runs
 * in the daily full-pass PR, so a miss here is caught within a day.
 *
 * Usage: bun src/scripts/affected-tests.ts [base-ref] [--print]
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export type Selection = { all: true } | { all: false; specs: string[] };

const SOURCE_ROOTS = ["src", "test", "scripts"];
const IMPORT_RE =
  /(?:from|import)\s*\(?\s*["']((?:\.{1,2}|[@~])\/[^"']*)["']|import\s+["']((?:\.{1,2}|[@~])\/[^"']*)["']/g;
// tsconfig "paths": "@/*" is src/*, "~/*" is test/*.
const ALIASES: Record<string, string> = { "@/": "src/", "~/": "test/" };
const isSpec = (file: string) => /\.spec\.tsx?$/.test(file);
// Specs that scan the sources with Glob instead of importing them: a new file
// nothing imports yet would reach none of them, so they always run.
const ALWAYS = ["test/boundaries.spec.ts"];
const isCode = (file: string) => file.endsWith(".ts") || file.endsWith(".tsx");

/** Files whose change the import graph cannot attribute to a spec. */
function forcesFullRun(file: string): boolean {
  if (file === "test/setup.ts") return true;
  if (SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`))) {
    return !isCode(file);
  }
  // Docs never run code; every other file outside src/, test/ and scripts/ (package.json,
  // bun.lock, bunfig.toml, tsconfig, biome.json, codegen.ts, schema.graphql,
  // Dockerfile, .github/...) can change how every spec runs.
  return !(file.endsWith(".md") || file.startsWith("docs/"));
}

export function listCodeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listCodeFiles(path));
    } else if (isCode(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Resolves a relative specifier to a known file, or undefined. */
function resolveImport(
  from: string,
  specifier: string,
  known: Set<string>,
): string | undefined {
  const alias = ALIASES[specifier.slice(0, 2)];
  const base = alias
    ? normalize(alias + specifier.slice(2))
    : normalize(join(dirname(from), specifier));
  const stripped = base.replace(/\.(js|ts|tsx)$/, "");
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => known.has(candidate));
}

/** Maps each file to the files that import it. */
export function buildDependents(
  files: Record<string, string>,
): Map<string, Set<string>> {
  const known = new Set(Object.keys(files));
  const dependents = new Map<string, Set<string>>();
  for (const [file, content] of Object.entries(files)) {
    for (const match of content.matchAll(IMPORT_RE)) {
      const target = resolveImport(
        file,
        (match[1] ?? match[2]) as string,
        known,
      );
      if (target) {
        const set = dependents.get(target) ?? new Set<string>();
        set.add(file);
        dependents.set(target, set);
      }
    }
  }
  return dependents;
}

export function selectSpecs(
  changed: string[],
  files: Record<string, string>,
): Selection {
  if (changed.some(forcesFullRun)) {
    return { all: true };
  }
  const dependents = buildDependents(files);
  const seen = new Set<string>(ALWAYS.filter((spec) => spec in files));
  const queue = changed.filter((file) => file in files);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    queue.push(...(dependents.get(file) ?? []));
  }
  return { all: false, specs: [...seen].filter(isSpec).sort() };
}

async function main() {
  const args = process.argv.slice(2);
  const print = args.includes("--print");
  const base = args.find((arg) => !arg.startsWith("--")) ?? "origin/develop";
  const diff = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`]);
  if (diff.exitCode !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.toString()}`);
  }
  const changed = diff.stdout.toString().split("\n").filter(Boolean);
  const files: Record<string, string> = {};
  for (const root of SOURCE_ROOTS) {
    for (const file of listCodeFiles(root)) {
      files[file] = readFileSync(file, "utf8");
    }
  }
  const selection = selectSpecs(changed, files);
  const specs = selection.all ? [] : selection.specs;
  console.log(
    selection.all
      ? "affected-tests: shared infrastructure changed, running every spec"
      : `affected-tests: ${specs.length} spec file(s) for ${changed.length} changed file(s)`,
  );
  if (print) {
    console.log(selection.all ? "ALL" : specs.join("\n"));
    return;
  }
  if (!selection.all && specs.length === 0) {
    return;
  }
  const run = Bun.spawnSync(
    [
      "bun",
      "test",
      "--timeout=15000",
      ...specs.map((spec) => (spec.startsWith("./") ? spec : `./${spec}`)),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exit(run.exitCode ?? 1);
}

if (import.meta.main) {
  await main();
}
