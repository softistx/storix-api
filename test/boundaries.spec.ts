import { describe, test } from "bun:test";
import { resolve } from "node:path";
import { assertBoundaries } from "@softistx/alxia-modules";
import { modules } from "../src/modules/registry";

// The module boundaries, for every registered module, kernel (`src/core/<name>`,
// surface `index.ts`) and business (`src/modules/<name>`, surface `public.ts`):
// a module reaches another only through its public surface, and only when its
// manifest's `dependsOn` names it. A folder that is not a registered module
// (`core/shared`, ...) is plain infrastructure.
const root = resolve(import.meta.dir, "..");

describe("the module boundaries", () => {
  test("src respects the surfaces, dependsOn and the core-below-modules layers", async () => {
    await assertBoundaries(modules, {
      root,
      roots: [
        { dir: "src/core", surface: "index" },
        { dir: "src/modules", surface: "public" },
      ],
      layers: ["src/core", "src/modules"],
      aliases: { "@/": "src/" },
    });
  });
});
