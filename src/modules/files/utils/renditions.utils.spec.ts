import { describe, expect, test } from "bun:test";
import { FILES_MAX_BYTES } from "@/core/storage";
import { RENDITION_MAX_PIXELS } from "../rules";
import {
  FocalMoved,
  fitSide,
  limits,
  makeFromPdf,
  storeUntilStable,
} from "./renditions.utils";

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

describe("storeUntilStable", () => {
  const stored = (log: string[]) => async (focal: { x: number } | null) => {
    log.push(focal ? String(focal.x) : "centre");
  };

  test("stores once when the point did not move", async () => {
    const log: string[] = [];
    const focal = await storeUntilStable({
      focal: null,
      store: stored(log),
      current: async () => null,
    });
    expect(focal).toBeNull();
    expect(log).toEqual(["centre"]);
  });

  test("stores again for a point that moved, until it holds", async () => {
    const log: string[] = [];
    const reads = [
      { x: 0.1, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ];
    const focal = await storeUntilStable({
      focal: null,
      store: stored(log),
      current: async () => reads.shift() ?? { x: 0.2, y: 0.5 },
    });
    expect(focal).toEqual({ x: 0.2, y: 0.5 });
    expect(log).toEqual(["centre", "0.1", "0.2"]);
  });

  test("stops when the node is gone", async () => {
    const log: string[] = [];
    await storeUntilStable({
      focal: null,
      store: stored(log),
      current: async () => undefined,
    });
    expect(log).toEqual(["centre"]);
  });

  test("throws a retryable error when the point never settles", async () => {
    let x = 0;
    const result = storeUntilStable({
      focal: null,
      store: async () => {},
      current: async () => {
        x += 0.1;
        return { x, y: 0.5 };
      },
      turns: 2,
    });
    await expect(result).rejects.toBeInstanceOf(FocalMoved);
  });
});
