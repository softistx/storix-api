import { expect, test } from "bun:test";
import { builtinModules } from "node:module";
import { join } from "node:path";

// restore.ts runs on a host that may have no node_modules (a lost host, before
// `bun install`): its bundle must import no package.
test("restore.ts bundles with no bare-package import", async () => {
  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--target=bun",
      "--packages=external",
      join(import.meta.dir, "restore.ts"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  const bare = [
    ...result.stdout
      .toString()
      .matchAll(/(?:from|import)\s*["']([^"'./][^"']*)["']/g),
  ]
    .map((m) => m[1] ?? "")
    .filter(
      (name) =>
        !name.startsWith("node:") &&
        !name.startsWith("bun") &&
        !builtinModules.includes(name),
    );
  expect(bare).toEqual([]);
});
