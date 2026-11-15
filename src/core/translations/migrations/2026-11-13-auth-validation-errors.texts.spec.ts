import { describe, expect, test } from "bun:test";
import { oldShape } from "./2026-11-13-auth-validation-errors.old-shape.fixture";
import { texts } from "./2026-11-13-auth-validation-errors.texts";

// This frozen file was reshaped (`{ en: {key: text}, fr: {…} }` to
// `{ key: { en, fr } }`) when @alxia/i18n 0.6.0 was adopted. The reshape must
// write exactly the rows the old shape did.
describe("2026-11-13 auth-validation-errors texts", () => {
  const rows = (entries: [string, string][]) => entries.sort();
  const fromOld = (locale: "en" | "fr") =>
    rows(Object.entries(oldShape[locale]));
  const fromNew = (locale: "en" | "fr") =>
    rows(
      Object.entries(texts).map(([key, text]) => [
        key,
        (text as Record<string, string>)[locale] ?? "",
      ]),
    );

  test("holds exactly the same keys", () => {
    expect(Object.keys(texts).sort()).toEqual(Object.keys(oldShape.en).sort());
    expect(Object.keys(oldShape.fr).sort()).toEqual(
      Object.keys(oldShape.en).sort(),
    );
  });

  test("writes the same English rows", () => {
    expect(fromNew("en")).toEqual(fromOld("en"));
  });

  test("writes the same French rows", () => {
    expect(fromNew("fr")).toEqual(fromOld("fr"));
  });

  test("has no other locale", () => {
    for (const text of Object.values(texts)) {
      expect(Object.keys(text).sort()).toEqual(["en", "fr"]);
    }
  });
});
