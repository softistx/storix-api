import { describe, expect, test } from "bun:test";
import { selectSpecs } from "./affected-tests";

const files = {
  "src/a/a.ts": "export const a = 1;",
  "src/a/a.spec.ts": 'import { a } from "./a";',
  "src/b/b.ts": 'import { a } from "../a/a";',
  "src/b/b.spec.ts": 'import { b } from "./b";',
  "src/c/index.ts": "export const c = 1;",
  "src/d/d.spec.ts": 'import { c } from "../c";',
  "src/e/e.ts": 'export * from "../a/a.js";',
  "test/world.ts": 'import { c } from "../src/c";',
  "test/boundaries.spec.ts": "",
  "src/f/f.spec.ts": 'import { w } from "~/world";',
  "src/g/g.spec.ts": 'import { a } from "@/a/a";',
  "scripts/dev.ts": "export const d = 1;",
  "scripts/dev.spec.ts": 'import { d } from "./dev";',
};

describe("selectSpecs", () => {
  test("a script selects its own spec; a non-code file under scripts/ selects all", () => {
    expect(selectSpecs(["scripts/dev.ts"], files)).toEqual({
      all: false,
      specs: ["scripts/dev.spec.ts", "test/boundaries.spec.ts"],
    });
    expect(selectSpecs(["scripts/notes.json"], files)).toEqual({ all: true });
  });

  test("picks the spec beside a changed file and the dependents' specs", () => {
    expect(selectSpecs(["src/a/a.ts"], files)).toEqual({
      all: false,
      specs: [
        "src/a/a.spec.ts",
        "src/b/b.spec.ts",
        "src/g/g.spec.ts",
        "test/boundaries.spec.ts",
      ],
    });
  });

  test("resolves directory indexes and test helpers transitively", () => {
    expect(selectSpecs(["src/c/index.ts"], files)).toEqual({
      all: false,
      specs: ["src/d/d.spec.ts", "src/f/f.spec.ts", "test/boundaries.spec.ts"],
    });
  });

  test("a changed spec runs itself plus the source scanners", () => {
    expect(selectSpecs(["src/b/b.spec.ts"], files)).toEqual({
      all: false,
      specs: ["src/b/b.spec.ts", "test/boundaries.spec.ts"],
    });
  });

  test("docs-only changes select nothing", () => {
    expect(selectSpecs(["docs/roadmap.md", "README.md"], files)).toEqual({
      all: false,
      specs: ["test/boundaries.spec.ts"],
    });
  });

  test.each([
    "package.json",
    "bun.lock",
    "tsconfig.json",
    ".github/workflows/ci.yml",
    "schema.graphql",
    "test/setup.ts",
    "src/x/query.graphqls",
  ])("%s selects the whole suite", (file) => {
    expect(selectSpecs([file], files)).toEqual({ all: true });
  });
});
