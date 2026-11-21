import { describe, expect, test } from "bun:test";
import { seedsOf } from "@softistx/alxia-i18n";
import { texts } from "./migrations/2026-11-13-auth-validation-errors.texts";

describe("seedsOf over the migration texts", () => {
  test("one row per code and language, code first", () => {
    const rows = seedsOf(texts);
    expect(rows).toHaveLength(Object.keys(texts).length * 2);
    expect(rows[0]).toEqual({
      key: "auth.errors.api-key-not-accepted",
      language: "en",
      text: "An API key cannot do this. Sign in with an account.",
    });
  });
});
