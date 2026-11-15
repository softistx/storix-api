import { renderImage } from "@softistx/image";
import { renderPdfFirstPage } from "@softistx/image/pdf";
import { FILES_MAX_BYTES } from "@/core/storage";
import {
  RENDITION_MAX_PIXELS,
  RENDITION_SIDES,
  RENDITION_SIZES,
  type RenditionKind,
  type RenditionSize,
} from "./files.renditions";

export interface MadeRendition {
  size: RenditionSize;
  bytes: Uint8Array;
  contentType: "image/webp";
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

// Every size of a file's bytes, as WebP with every piece of metadata stripped.
// `ImageError` (undecodable, too large, not that type) says the file itself
// cannot be rendered: retrying cannot help.
export async function makeRenditions(
  bytes: Uint8Array,
  kind: RenditionKind,
  signal?: AbortSignal,
): Promise<MadeRendition[]> {
  if (kind === "pdf") return makeFromPdf(bytes, signal);
  // The upright size, which EXIF orientation may swap, is read by a first
  // render of one pixel.
  const { source } = await renderImage(bytes, {
    width: 1,
    height: 1,
    format: "webp",
    ...limits(signal),
  });
  const made: MadeRendition[] = [];
  for (const size of RENDITION_SIZES) {
    const target = fitSide(source.width, source.height, RENDITION_SIDES[size]);
    const image = await renderImage(bytes, {
      ...target,
      format: "webp",
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/webp" });
  }
  return made;
}

// Page 1 of a PDF, drawn at the size's width and capped at its side, so a tall
// page is not taller than the longest side.
async function makeFromPdf(bytes: Uint8Array, signal: AbortSignal | undefined) {
  const made: MadeRendition[] = [];
  for (const size of RENDITION_SIZES) {
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
