import { describe, expect, test } from "bun:test";
import { janusImporters } from "./janus-imports-check";

describe("janusImporters", () => {
  test("allows the identity seam and nothing else", () => {
    const files = {
      "src/core/identity/identity.janus.ts":
        'import { createJanus } from "@softistx/janus";',
      "src/config/auth.ts": 'import { x } from "@softistx/janus-mongo";',
      "src/modules/nodes/nodes.service.ts":
        'import { StoreFailure } from "@softistx/janus";',
      "src/modules/files/files.ts": 'import("@softistx/janus-graphql");',
      "src/modules/teams/teams.ts": 'import { a } from "@softistx/mongo";',
    };
    expect(janusImporters(files)).toEqual([
      "src/modules/files/files.ts",
      "src/modules/nodes/nodes.service.ts",
    ]);
  });
});
