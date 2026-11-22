import { describe, expect, test } from "bun:test";
import { nameOf } from "./name.utils";

describe("nameOf", () => {
  test("trims a good name", () => {
    expect(nameOf("  Photos ")).toBe("Photos");
  });

  test("refuses a blank name and a path-like one", () => {
    expect(() => nameOf("   ")).toThrow();
    expect(() => nameOf("a/b")).toThrow();
    expect(() => nameOf("..")).toThrow();
  });
});
