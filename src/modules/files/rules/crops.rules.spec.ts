import { describe, expect, test } from "bun:test";
import { FILES_SIZES } from "@/core/storage/storage.kinds";
import { CROP_SIZES, CROP_SPECS, cropBox, targetSize } from "./crops.rules";
import { RENDITION_SIZES, sizesOf } from "./renditions.rules";

describe("crop geometry", () => {
  test("the worker's sizes are the files kind's sizes", () => {
    expect([...RENDITION_SIZES]).toEqual([...FILES_SIZES]);
  });

  test("a crop is centred when there is no focal point", () => {
    expect(cropBox({ width: 2000, height: 1000 }, 1, null)).toEqual({
      x: 500,
      y: 0,
      width: 1000,
      height: 1000,
    });
  });

  test("a crop is centred on the focal point and held inside the picture", () => {
    const source = { width: 2000, height: 1000 };
    expect(cropBox(source, 1, { x: 0.75, y: 0.5 }).x).toBe(1000);
    expect(cropBox(source, 1, { x: 0, y: 0 }).x).toBe(0);
    expect(cropBox(source, 1, { x: 1, y: 1 }).x).toBe(1000);
    const tall = { width: 1000, height: 3000 };
    expect(cropBox(tall, 1, { x: 0.5, y: 0.25 })).toEqual({
      x: 0,
      y: 250,
      width: 1000,
      height: 1000,
    });
  });

  test("a crop is written at its preset's size, never enlarged", () => {
    expect(targetSize("square", { width: 3000, height: 3000 })).toEqual({
      width: 1080,
      height: 1080,
    });
    const small = targetSize("story", { width: 90, height: 160 });
    expect(small.width).toBeLessThanOrEqual(90);
    expect(small.height).toBeLessThanOrEqual(160);
    expect(small.width / small.height).toBeCloseTo(9 / 16, 1);
  });

  test("the presets are publix's", () => {
    expect(CROP_SIZES).toEqual(["square", "portrait", "story", "landscape"]);
    expect(CROP_SPECS.portrait).toMatchObject({ width: 1080, height: 1350 });
    expect(CROP_SPECS.landscape).toMatchObject({ width: 1920, height: 1080 });
  });

  test("a PDF has the previews only, a text none", () => {
    expect(sizesOf("application/pdf")).toEqual(["thumb", "preview"]);
    expect(sizesOf("image/png")).toHaveLength(6);
    expect(sizesOf("text/plain")).toEqual([]);
  });
});
