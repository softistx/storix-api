import { describe, expect, test } from "bun:test";
import { transferLabel } from "./transfer.utils";

describe("transferLabel", () => {
  test("names the folder after the leaver", () => {
    expect(transferLabel("Ada")).toBe("Files of Ada");
  });

  test("drops slashes and control characters and collapses spaces", () => {
    expect(transferLabel("  a/b\\c\u0000 d\n e  ")).toBe("Files of a b c d e");
  });

  test("falls back to a former member when the name is missing or empty", () => {
    expect(transferLabel(null)).toBe("Files of a former member");
    expect(transferLabel(" / ")).toBe("Files of a former member");
  });

  test("truncates a long name to 200 characters", () => {
    expect(transferLabel("x".repeat(500))).toBe(`Files of ${"x".repeat(200)}`);
  });
});
