import { describe, expect, test } from "bun:test";
import { roleNodeOf } from "./roles.utils";

describe("roleNodeOf", () => {
  test("carries the ids as hex-readable values and the owner", () => {
    const node = roleNodeOf({ id: "c", ancestors: ["a", "b"], ownerId: "x" });
    expect(node._id.toHexString()).toBe("c");
    expect(node.ancestors.map((a) => a.toHexString())).toEqual(["a", "b"]);
    expect(node.ownerId).toBe("x");
  });

  test("keeps a missing owner null", () => {
    expect(
      roleNodeOf({ id: "c", ancestors: [], ownerId: null }).ownerId,
    ).toBeNull();
  });
});
