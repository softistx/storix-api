// The geometry of the four crops, pure: which part of a picture a preset keeps
// and how big it is written. Ported from publix's media.crops.ts (same presets,
// same sizes, by design). The pixels are `renderImage`'s (@softistx/image).

export interface Size {
  width: number;
  height: number;
}
export interface Box extends Size {
  x: number;
  y: number;
}
// Fractions of the picture from its top left corner: 0 to 1.
export interface Focal {
  x: number;
  y: number;
}

export const CROP_SIZES = ["square", "portrait", "story", "landscape"] as const;
export type CropSize = (typeof CROP_SIZES)[number];

export interface CropSpec {
  // Width over height of the crop.
  aspect: number;
  // The size written, never above the crop.
  width: number;
  height: number;
  quality: number;
}

export const CROP_SPECS: Record<CropSize, CropSpec> = {
  square: { aspect: 1, width: 1080, height: 1080, quality: 85 },
  portrait: { aspect: 4 / 5, width: 1080, height: 1350, quality: 85 },
  story: { aspect: 9 / 16, width: 1080, height: 1920, quality: 85 },
  landscape: { aspect: 16 / 9, width: 1920, height: 1080, quality: 85 },
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

// The largest box of `aspect` inside the source, centred on the focal point
// (null is the centre) and moved back inside the source near an edge.
export function cropBox(
  source: Size,
  aspect: number,
  focal: Focal | null,
): Box {
  let width: number;
  let height: number;
  if (source.width / source.height > aspect) {
    height = source.height;
    width = Math.min(source.width, Math.max(1, Math.round(height * aspect)));
  } else {
    width = source.width;
    height = Math.min(source.height, Math.max(1, Math.round(width / aspect)));
  }
  const at = focal ?? { x: 0.5, y: 0.5 };
  return {
    x: clamp(
      Math.round(at.x * source.width - width / 2),
      0,
      source.width - width,
    ),
    y: clamp(
      Math.round(at.y * source.height - height / 2),
      0,
      source.height - height,
    ),
    width,
    height,
  };
}

// The size a crop writes from its box: the preset's own, or the box's when it
// is smaller (a picture is never enlarged), keeping the box's proportions.
export function targetSize(size: CropSize, box: Size): Size {
  const spec = CROP_SPECS[size];
  if (box.width >= spec.width && box.height >= spec.height) {
    return { width: spec.width, height: spec.height };
  }
  const scale = Math.min(box.width / spec.width, box.height / spec.height);
  return {
    width: clamp(Math.round(spec.width * scale), 1, box.width),
    height: clamp(Math.round(spec.height * scale), 1, box.height),
  };
}
