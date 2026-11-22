import { describe, expect, test } from "bun:test";
import {
  checkTags,
  MAX_META_BYTES,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  metaFits,
} from "./tags.rules";

describe("checkTags", () => {
  test("trims, lower-cases, drops empties and counts a repeat once", () => {
    expect(checkTags([" Red ", "red", "", "Blue"])).toEqual({
      tags: ["red", "blue"],
    });
  });

  test("refuses too many tags and a tag that is too long", () => {
    const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`);
    expect(checkTags(many)).toEqual({
      issue: "validation.errors.too-many",
      max: MAX_TAGS,
    });
    expect(checkTags(["x".repeat(MAX_TAG_LENGTH + 1)])).toEqual({
      issue: "validation.errors.too-long",
      max: MAX_TAG_LENGTH,
    });
  });
});

describe("metaFits", () => {
  test("takes a JSON object within the size", () => {
    expect(metaFits({ a: 1 })).toBe(true);
  });

  test("refuses an array, a scalar, null and an object over the size", () => {
    expect(metaFits([1])).toBe(false);
    expect(metaFits("x")).toBe(false);
    expect(metaFits(null)).toBe(false);
    expect(metaFits({ big: "x".repeat(MAX_META_BYTES) })).toBe(false);
  });
});
