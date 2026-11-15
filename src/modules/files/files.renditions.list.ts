import { type RenditionSize, sizesOf } from "./files.renditions";

// A rendition as `File.renditions` lists it: the preset, the name the URL has
// (`GET /media/files/<key>/<size>`), and the format it is stored in.
export interface RenditionView {
  preset: Uppercase<RenditionSize>;
  size: RenditionSize;
  mimeType: "image/webp" | "image/jpeg";
}

const CROPS: readonly RenditionSize[] = [
  "square",
  "portrait",
  "story",
  "landscape",
];

// The sizes a file has now: those of its type once it is `READY`, none while
// the worker is at it (`PROCESSING`: the crops may be stale) or after it gave
// up (`FAILED`). Derived from the node, with no read of the store.
export function renditionsOf(file: {
  mimeType: string;
  status: string;
}): RenditionView[] {
  if (file.status !== "READY") return [];
  return sizesOf(file.mimeType).map((size) => ({
    preset: size.toUpperCase() as RenditionView["preset"],
    size,
    mimeType: CROPS.includes(size) ? "image/jpeg" : "image/webp",
  }));
}
