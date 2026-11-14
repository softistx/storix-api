import { describe, expect, test } from "bun:test";
import { missingMessages } from "./missing-messages";

describe("missingMessages", () => {
  const rows = [
    { code: "a.errors.x", language: "en", text: "X" },
    { code: "a.errors.x", language: "fr", text: "X" },
    { code: "a.errors.y", language: "en", text: "Y" },
  ];

  test("is empty when every code has every language", () => {
    expect(missingMessages(["a.errors.x"], rows, ["en", "fr"])).toEqual([]);
  });

  test("names a code that lacks a language, and a code that lacks both", () => {
    expect(
      missingMessages(["a.errors.x", "a.errors.y", "a.errors.z"], rows, [
        "en",
        "fr",
      ]),
    ).toEqual(["a.errors.y (fr)", "a.errors.z (en)", "a.errors.z (fr)"]);
  });
});
