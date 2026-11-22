import { describe, expect, test } from "bun:test";
import { counted } from "./accounting.utils";

describe("counted", () => {
  test("counts nothing for a blob that is not held", () => {
    expect(counted(undefined)).toEqual({
      bytes: 0,
      versionBytes: 0,
      trashBytes: 0,
    });
    expect(counted({ size: 5, state: "none" }).bytes).toBe(0);
  });

  test("counts a live blob in bytes only", () => {
    expect(counted({ size: 5, state: "live" })).toEqual({
      bytes: 5,
      versionBytes: 0,
      trashBytes: 0,
    });
  });

  test("counts a trashed or version-only blob in its own part too", () => {
    expect(counted({ size: 5, state: "trash" })).toEqual({
      bytes: 5,
      versionBytes: 0,
      trashBytes: 5,
    });
    expect(counted({ size: 5, state: "versions" })).toEqual({
      bytes: 5,
      versionBytes: 5,
      trashBytes: 0,
    });
  });
});
