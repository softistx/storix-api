import type { RenditionJob } from "@/queues/renditions";
import { CROP_SIZES } from "./crops.rules";

// What the worker makes of a file (plan §3.4, §3.10), named by the `files`
// kind's `sizes` (src/core/storage/storage.kinds.ts): `thumb` and `preview`,
// as WebP, for a picture and a PDF; and, for a picture only, the four crops
// centred on the focal point, as JPEG.
export const PREVIEW_SIZES = ["thumb", "preview"] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];
export { CROP_SIZES };
export const RENDITION_SIZES = [...PREVIEW_SIZES, ...CROP_SIZES] as const;
export type RenditionSize = (typeof RENDITION_SIZES)[number];

// The longest side of each preview, in pixels. A picture is never enlarged.
export const RENDITION_SIDES: Record<PreviewSize, number> = {
  thumb: 320,
  preview: 1_600,
};

// The most pixels a picture may claim (width x height). 50 MP is about 200 MB
// decoded as RGBA at the peak, and the worker decodes two at a time.
export const RENDITION_MAX_PIXELS = 50_000_000;

export type RenditionKind = "image" | "pdf";

// How a stored type is rendered, or null when it keeps its family icon in v1
// (animated images, video and audio included: UP-6). The status of a file of
// such a type is `READY` from the start.
export function renditionKindOf(mimeType: string): RenditionKind | null {
  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/webp"
  ) {
    return "image";
  }
  return mimeType === "application/pdf" ? "pdf" : null;
}

// The sizes a stored type has once it is `READY`: every one for a picture, the
// previews for a PDF, none for the rest.
export function sizesOf(mimeType: string): readonly RenditionSize[] {
  const kind = renditionKindOf(mimeType);
  if (kind === "image") return RENDITION_SIZES;
  return kind === "pdf" ? PREVIEW_SIZES : [];
}

// What `addFile` needs of the queue: the real one, `redis.queues.renditions`,
// fits. Without one (no REDIS_URL) a file is `READY` and has no previews.
export interface RenditionsQueue {
  add(job: RenditionJob, options?: { id?: string }): Promise<unknown>;
}
