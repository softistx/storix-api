import { describe, expect, test } from "bun:test";
import { seedsOf } from "./translations.seeds";

describe("seedsOf", () => {
  test("one seed per code and language, sorted by code", () => {
    expect(
      seedsOf({
        en: { "b.errors.x": "X", "a.errors.y": "Y" },
        fr: { "b.errors.x": "Xf", "a.errors.y": "Yf" },
      }),
    ).toEqual([
      { code: "a.errors.y", language: "en", text: "Y" },
      { code: "a.errors.y", language: "fr", text: "Yf" },
      { code: "b.errors.x", language: "en", text: "X" },
      { code: "b.errors.x", language: "fr", text: "Xf" },
    ]);
  });

  test("refuses a code a language lacks", () => {
    expect(() => seedsOf({ en: { "a.errors.y": "Y" }, fr: {} })).toThrow(
      'translation "a.errors.y" has no fr text',
    );
  });
});
