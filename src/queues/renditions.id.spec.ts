import { describe, expect, test } from "bun:test";
import {
  buildRenditionJobId,
  focalTokenOf,
  parseRenditionId,
} from "./renditions.id";

const base = { workspaceId: "w1", key: "k1" };

describe("the renditions job id", () => {
  test("a point is a colon-free token in thousandths", () => {
    expect(focalTokenOf({ x: 0.5, y: 0.25 })).toBe("fp500_250");
    expect(focalTokenOf({ x: 0.3333, y: 1 })).toBe("fp333_1000");
    expect(focalTokenOf(null)).toBe("fpc");
  });

  test("a job with no point keeps the legacy id", () => {
    expect(buildRenditionJobId(base)).toBe("w1:k1");
    expect(buildRenditionJobId(base, "stuck1-abc")).toBe("w1:k1:stuck1-abc");
  });

  test("the token comes before the redo token and parses back", () => {
    const id = buildRenditionJobId(
      { ...base, focalPoint: { x: 0.5, y: 0.25 } },
      "r-1",
    );
    expect(id).toBe("w1:k1:fp500_250:r-1");
    expect(parseRenditionId(id)).toEqual({
      ...base,
      focalPoint: { x: 0.5, y: 0.25 },
    });
  });

  test("the centre parses as null, a legacy id as no point", () => {
    expect(
      parseRenditionId(buildRenditionJobId({ ...base, focalPoint: null })),
    ).toEqual({ ...base, focalPoint: null });
    expect(parseRenditionId("w1:k1")).toEqual(base);
    expect(parseRenditionId("w1:k1:redo-token")).toEqual(base);
    expect(parseRenditionId("w1")).toBeNull();
  });
});
