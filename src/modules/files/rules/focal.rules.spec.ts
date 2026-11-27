import { describe, expect, test } from "bun:test";
import { isMediaKey } from "@softistx/alxia-media";
import { cropsKeyOf, isFocal, roundFocal, sameFocal } from "./focal.rules";

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

describe("sameFocal", () => {
  test("matches a point by its coordinates", () => {
    expect(sameFocal({ x: 0.2, y: 0.3 })).toEqual({
      "focalPoint.x": 0.2,
      "focalPoint.y": 0.3,
    });
  });

  test("matches the centre as null, whether stored null or absent", () => {
    expect(sameFocal(null)).toEqual({ focalPoint: null });
    expect(sameFocal(undefined)).toEqual({ focalPoint: null });
  });
});

describe("cropsKeyOf", () => {
  const blob = "11111111-2222-4333-8444-555555555555";

  test("the centre is the blob's own key", () => {
    expect(cropsKeyOf(blob, null)).toBe(blob);
    expect(cropsKeyOf(blob, undefined)).toBe(blob);
  });

  test("a point is a stable media key, the same for the same rounded point", () => {
    const key = cropsKeyOf(blob, { x: 0.3, y: 0.6 });
    expect(isMediaKey(key)).toBe(true);
    expect(key).not.toBe(blob);
    expect(cropsKeyOf(blob, { x: 0.3, y: 0.6 })).toBe(key);
    expect(cropsKeyOf(blob, { x: 0.30001, y: 0.59999 })).toBe(key);
  });

  test("another point or another blob is another key", () => {
    const key = cropsKeyOf(blob, { x: 0.3, y: 0.6 });
    expect(cropsKeyOf(blob, { x: 0.6, y: 0.3 })).not.toBe(key);
    expect(
      cropsKeyOf("11111111-2222-4333-8444-555555555556", { x: 0.3, y: 0.6 }),
    ).not.toBe(key);
  });

  test("roundFocal keeps a thousandth", () => {
    expect(roundFocal({ x: 0.12345, y: 1 })).toEqual({ x: 0.123, y: 1 });
  });
});
