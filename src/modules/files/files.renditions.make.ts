import { renderImage } from "@softistx/image";
import { renderPdfFirstPage } from "@softistx/image/pdf";
import { FILES_MAX_BYTES } from "@/core/storage";
import { CROP_SPECS, cropBox, type Focal, targetSize } from "./files.crops";
import {
  CROP_SIZES,
  PREVIEW_SIZES,
  RENDITION_MAX_PIXELS,
  RENDITION_SIDES,
  type RenditionKind,
  type RenditionSize,
} from "./files.renditions";

export interface MadeRendition {
  size: RenditionSize;
  bytes: Uint8Array;
  contentType: "image/webp" | "image/jpeg";
}

// The limits the `files` kind allows: the 95 MiB the upload takes, and a
// pixel count that bounds the memory of one decode.
const limits = (signal: AbortSignal | undefined) => ({
  maxBytes: FILES_MAX_BYTES,
  maxPixels: RENDITION_MAX_PIXELS,
  ...(signal && { signal }),
});

// The target that keeps the picture's ratio with its longest side at `side`,
// never larger than the picture itself.
export function fitSide(width: number, height: number, side: number) {
  const scale = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface MakeOptions {
  signal?: AbortSignal | undefined;
  // The picture's focal point; null is the centre. Only the crops read it.
  focal?: Focal | null | undefined;
  // Only the four crops: what a move of the focal point redoes.
  cropsOnly?: boolean | undefined;
}

// Every size of a file's bytes with every piece of metadata stripped: the
// previews as WebP, and for a picture the four crops as JPEG, centred on the
// focal point. `ImageError` (undecodable, too large, not that type) says the
// file itself cannot be rendered: retrying cannot help.
export async function makeRenditions(
  bytes: Uint8Array,
  kind: RenditionKind,
  options: MakeOptions = {},
): Promise<MadeRendition[]> {
  const { signal } = options;
  if (kind === "pdf")
    return options.cropsOnly ? [] : makeFromPdf(bytes, signal);
  // The upright size, which EXIF orientation may swap, is read by a first
  // render of one pixel.
  const { source } = await renderImage(bytes, {
    width: 1,
    height: 1,
    format: "webp",
    ...limits(signal),
  });
  const made: MadeRendition[] = [];
  for (const size of options.cropsOnly ? [] : PREVIEW_SIZES) {
    const target = fitSide(source.width, source.height, RENDITION_SIDES[size]);
    const image = await renderImage(bytes, {
      ...target,
      format: "webp",
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/webp" });
  }
  for (const size of CROP_SIZES) {
    const spec = CROP_SPECS[size];
    const box = cropBox(source, spec.aspect, options.focal ?? null);
    const target = targetSize(size, box);
    const image = await renderImage(bytes, {
      crop: { x: box.x, y: box.y, width: box.width, height: box.height },
      ...target,
      format: "jpeg",
      quality: spec.quality,
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/jpeg" });
  }
  return made;
}

// Page 1 of a PDF, drawn at the size's width and capped at its side, so a tall
// page is not taller than the longest side.
async function makeFromPdf(bytes: Uint8Array, signal: AbortSignal | undefined) {
  const made: MadeRendition[] = [];
  for (const size of PREVIEW_SIZES) {
    const side = RENDITION_SIDES[size];
    const image = await renderPdfFirstPage(bytes, {
      width: side,
      height: side,
      format: "webp",
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/webp" });
  }
  return made;
}
