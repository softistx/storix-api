import { describe, expect, test } from "bun:test";
import type { NodeDoc } from "../models";
import { depthOf } from "./tree.utils";

describe("depthOf", () => {
  test("a root is depth 1 and each ancestor adds one", () => {
    expect(depthOf({ ancestors: [] } as unknown as NodeDoc)).toBe(1);
    expect(depthOf({ ancestors: [1, 2] } as unknown as NodeDoc)).toBe(3);
  });
});
