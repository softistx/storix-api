import { describe, expect, test } from "bun:test";
import { defineCodes } from "./define-codes";

describe("defineCodes", () => {
  test("names each slug <module>.errors.<slug>", () => {
    expect(defineCodes("nodes", ["not-found", "name-taken"])).toEqual([
      "nodes.errors.not-found",
      "nodes.errors.name-taken",
    ]);
  });
});
