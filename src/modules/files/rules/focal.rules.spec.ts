import { describe, expect, test } from "bun:test";
import { isFocal } from "./focal.rules";

describe("isFocal", () => {
  test("takes coordinates from 0 to 1, bounds included", () => {
    expect(isFocal({ x: 0, y: 1 })).toBe(true);
    expect(isFocal({ x: 0.25, y: 0.75 })).toBe(true);
  });

  test("refuses a coordinate out of range or not finite", () => {
    expect(isFocal({ x: -0.1, y: 0.5 })).toBe(false);
    expect(isFocal({ x: 0.5, y: 1.1 })).toBe(false);
    expect(isFocal({ x: Number.NaN, y: 0.5 })).toBe(false);
    expect(isFocal({ x: 0.5, y: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
