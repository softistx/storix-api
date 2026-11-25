import { describe, expect, test } from "bun:test";
import { levelOf, QUOTA_LEVELS } from "./levels.utils";

describe("the quota level of a usage", () => {
  test("the thresholds are 80 and 100", () => {
    expect([...QUOTA_LEVELS]).toEqual([80, 100]);
  });

  test.each([
    [0, 100, 0],
    [79, 100, 0],
    [80, 100, 80],
    [99, 100, 80],
    [100, 100, 100],
    [8, 10, 80],
    [7, 10, 0],
  ])("%d of %d bytes is level %d", (bytes, quota, level) => {
    expect(levelOf(bytes, quota)).toBe(level as 0 | 80 | 100);
  });

  test("a quota of zero or less never alerts", () => {
    expect(levelOf(5, 0)).toBe(0);
    expect(levelOf(5, -1)).toBe(0);
  });
});
