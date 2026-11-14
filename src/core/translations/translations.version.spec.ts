import { describe, expect, test } from "bun:test";
import { seedsOf } from "@alxia/i18n";
import { texts } from "./migrations/2026-11-13-auth-validation-errors.texts";
import { buildServed } from "./translations.load";

// The digests the catalogue served before it moved to @alxia/i18n 0.6.0: a
// client that cached a version keeps its cache across the upgrade.
describe("the catalogue version", () => {
  test("is the digest the in-house implementation computed for the same rows", () => {
    const { served } = buildServed(seedsOf(texts));
    expect(served.get("en")?.version).toBe("ebfc0d42984ace8ed8216a712839daf6");
    expect(served.get("fr")?.version).toBe("96c0555b78157f0f561ef69a51f8f41a");
  });
});
