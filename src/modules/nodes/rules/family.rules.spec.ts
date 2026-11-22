import { describe, expect, test } from "bun:test";
import { familyOf } from "./family.rules";

describe("familyOf", () => {
  test.each([
    ["image/png", "IMAGE"],
    ["video/mp4", "VIDEO"],
    ["audio/mpeg", "AUDIO"],
    ["application/pdf", "PDF"],
    ["text/plain", "DOCUMENT"],
    ["text/markdown", "DOCUMENT"],
    ["text/x-python", "CODE"],
    ["application/zip", "ARCHIVE"],
    ["application/x-custom", "OTHER"],
  ])("%s is %s", (mime, family) => {
    expect(familyOf(mime)).toBe(family as never);
  });
});
