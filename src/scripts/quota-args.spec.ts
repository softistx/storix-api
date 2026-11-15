import { describe, expect, test } from "bun:test";
import { parseBytes } from "./quota-args";

describe("parseBytes", () => {
  test("reads bytes and binary units", () => {
    expect(parseBytes("21474836480")).toBe(21474836480);
    expect(parseBytes("20GiB")).toBe(20 * 1024 ** 3);
    expect(parseBytes("512 mib")).toBe(512 * 1024 ** 2);
  });
  test("refuses what is not a positive whole number of bytes", () => {
    for (const bad of [undefined, "", "0", "-1", "1.5GiB", "10GB", "x"]) {
      expect(parseBytes(bad)).toBeUndefined();
    }
  });
});
