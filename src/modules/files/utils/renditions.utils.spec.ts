import { describe, expect, test } from "bun:test";
import { FILES_MAX_BYTES } from "@/core/storage";
import { RENDITION_MAX_PIXELS } from "../rules";
import { fitSide, limits, makeFromPdf } from "./renditions.utils";

// A one-page PDF with no text: pdf.js draws it as a blank page.
const PDF = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj",
    "trailer<</Root 1 0 R/Size 4>>",
    "%%EOF",
  ].join("\n"),
);

describe("fitSide", () => {
  test("keeps the ratio with the longest side at the target", () => {
    expect(fitSide(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitSide(1000, 3000, 300)).toEqual({ width: 100, height: 300 });
  });

  test("never enlarges a picture and never reaches zero", () => {
    expect(fitSide(100, 50, 1600)).toEqual({ width: 100, height: 50 });
    expect(fitSide(10_000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe("limits", () => {
  test("bounds the bytes and the pixels, and carries a signal when given", () => {
    const signal = new AbortController().signal;
    expect(limits(undefined)).toEqual({
      maxBytes: FILES_MAX_BYTES,
      maxPixels: RENDITION_MAX_PIXELS,
    });
    expect(limits(signal).signal).toBe(signal);
  });
});

describe("makeFromPdf", () => {
  test("draws the two previews of page 1 as WebP", async () => {
    const made = await makeFromPdf(PDF, undefined);
    expect(made.map((one) => one.size)).toEqual(["thumb", "preview"]);
    expect(made.every((one) => one.contentType === "image/webp")).toBe(true);
    expect(made.every((one) => one.bytes.length > 0)).toBe(true);
  });
});
