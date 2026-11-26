import { describe, expect, test } from "bun:test";
import { orphanBrake } from "./sweep.rules";

describe("orphanBrake", () => {
  test("needs ten unrecorded keys, then no recorded blob or over half of them", () => {
    expect(orphanBrake(9, 0)).toBe(false);
    expect(orphanBrake(10, 0)).toBe(true);
    expect(orphanBrake(10, 20)).toBe(false);
    expect(orphanBrake(11, 20)).toBe(true);
  });
});
