import { describe, expect, test } from "bun:test";
import { levelOf, QUOTA_LEVELS } from "./levels.utils";

describe("the quota level of a usage", () => {
  test("the thresholds are 85 and 95", () => {
    expect([...QUOTA_LEVELS]).toEqual([85, 95]);
  });

  test.each([
    [0, 100, 0],
    [84, 100, 0],
    [85, 100, 85],
    [94, 100, 85],
    [95, 100, 95],
    [100, 100, 95],
    [9, 10, 85],
    [8, 10, 0],
  ])("%d of %d bytes is level %d", (bytes, quota, level) => {
    expect(levelOf(bytes, quota)).toBe(level as 0 | 85 | 95);
  });

  test("a quota of zero or less never alerts", () => {
    expect(levelOf(5, 0)).toBe(0);
    expect(levelOf(5, -1)).toBe(0);
  });
});
