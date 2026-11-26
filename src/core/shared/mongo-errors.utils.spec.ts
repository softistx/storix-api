import { describe, expect, test } from "bun:test";
import { isDuplicateKey } from "./mongo-errors.utils";

describe("isDuplicateKey", () => {
  test("is true for a unique-index refusal (code 11000)", () => {
    expect(isDuplicateKey({ code: 11000 })).toBe(true);
  });

  test("is false for another error, a bare value or nothing", () => {
    expect(isDuplicateKey({ code: 121 })).toBe(false);
    expect(isDuplicateKey(new Error("boom"))).toBe(false);
    expect(isDuplicateKey("11000")).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
  });
});
