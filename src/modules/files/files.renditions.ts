import type { RenditionJob } from "@/queues/renditions";

// What the worker makes of a file (plan §3.4, §3.10): `thumb` and `preview`, as
// WebP, named by the `files` kind's `sizes` (src/core/storage/storage.kinds.ts).
export const RENDITION_SIZES = ["thumb", "preview"] as const;
export type RenditionSize = (typeof RENDITION_SIZES)[number];

// The longest side of each size, in pixels. A picture is never enlarged.
export const RENDITION_SIDES: Record<RenditionSize, number> = {
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

// What `addFile` needs of the queue: the real one, `redis.queues.renditions`,
// fits. Without one (no REDIS_URL) a file is `READY` and has no previews.
export interface RenditionsQueue {
  add(job: RenditionJob, options?: { id?: string }): Promise<unknown>;
}
