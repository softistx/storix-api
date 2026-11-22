import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { janusImporters } from "./janus-imports-check";

describe("janusImporters", () => {
  test("allows the identity seam and nothing else", () => {
    const files = {
      "src/core/identity/identity.janus.ts":
        'import { createJanus } from "@softistx/janus";',
      "src/config/auth.ts": 'import { x } from "@softistx/janus-mongo";',
      "src/modules/nodes/nodes.service.ts":
        'import { StoreFailure } from "@softistx/janus";',
      "src/modules/files/services/files.service.ts":
        'import("@softistx/janus-graphql");',
      "src/modules/teams/teams.ts": 'import { a } from "@softistx/mongo";',
    };
    expect(janusImporters(files)).toEqual([
      "src/modules/files/services/files.service.ts",
      "src/modules/nodes/nodes.service.ts",
    ]);
  });

  test("refuses a subpath import and a side-effect import", () => {
    expect(
      janusImporters({
        "src/http/a.ts": 'import { totpCode } from "@softistx/janus/testing";',
        "src/http/b.ts": 'import "@softistx/janus-mail";',
      }),
    ).toEqual(["src/http/a.ts", "src/http/b.ts"]);
  });

  test("the tree itself imports janus only inside the seam", async () => {
    const root = new URL("../..", import.meta.url).pathname;
    const files: Record<string, string> = {};
    for await (const file of new Glob("src/**/*.ts").scan({ cwd: root })) {
      if (file === "src/scripts/janus-imports-check.spec.ts") continue;
      files[file] = await Bun.file(`${root}${file}`).text();
    }
    expect(janusImporters(files)).toEqual([]);
  });
});
