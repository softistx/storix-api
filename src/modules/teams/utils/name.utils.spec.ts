import { describe, expect, test } from "bun:test";
import { nameOf } from "./name.utils";

describe("nameOf", () => {
  test("trims a good name", () => {
    expect(nameOf("  Design ")).toBe("Design");
  });

  test("refuses a blank name", () => {
    expect(() => nameOf("   ")).toThrow();
  });
});
