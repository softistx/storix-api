import { CROP_SIZES } from "./files.crops";
import { type RenditionSize, sizesOf } from "./files.renditions";

type Preset =
  | "THUMB"
  | "PREVIEW"
  | "SQUARE"
  | "PORTRAIT"
  | "STORY"
  | "LANDSCAPE";

// A rendition as `File.renditions` lists it: the preset, the name the URL has
// (`GET /media/files/<key>/<size>`), and the format it is stored in.
export interface RenditionView {
  preset: Preset;
  size: RenditionSize;
  mimeType: "image/webp" | "image/jpeg";
}

const PRESETS: Record<RenditionSize, Preset> = {
  thumb: "THUMB",
  preview: "PREVIEW",
  square: "SQUARE",
  portrait: "PORTRAIT",
  story: "STORY",
  landscape: "LANDSCAPE",
};

const isCrop = (size: RenditionSize) =>
  CROP_SIZES.some((crop) => crop === size);

// The sizes a file has now: those of its type once it is `READY`, none while
// the worker is at it (`PROCESSING`: the crops may be stale) or after it gave
// up (`FAILED`). Derived from the node, with no read of the store.
export function renditionsOf(file: {
  mimeType: string;
  status: string;
}): RenditionView[] {
  if (file.status !== "READY") return [];
  return sizesOf(file.mimeType).map((size) => ({
    preset: PRESETS[size],
    size,
    mimeType: isCrop(size) ? "image/jpeg" : "image/webp",
  }));
}
