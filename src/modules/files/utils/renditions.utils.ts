import { renderPdfFirstPage } from "@softistx/image/pdf";
import { FILES_MAX_BYTES } from "@/core/storage";
import {
  PREVIEW_SIZES,
  RENDITION_MAX_PIXELS,
  RENDITION_SIDES,
  type RenditionSize,
} from "../rules";

export interface MadeRendition {
  size: RenditionSize;
  bytes: Uint8Array;
  contentType: "image/webp" | "image/jpeg";
}

// The limits the `files` kind allows: the 95 MiB the upload takes, and a
// pixel count that bounds the memory of one decode.
export const limits = (signal: AbortSignal | undefined) => ({
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

// Page 1 of a PDF, drawn at the size's width and capped at its side, so a tall
// page is not taller than the longest side.
export async function makeFromPdf(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
) {
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
