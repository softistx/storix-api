import { createHash } from "node:crypto";
import type { Focal } from "./crops.rules";

// A coordinate is a number from 0 to 1 (fractions of the picture).
export const isFocal = (focal: Focal) =>
  [focal.x, focal.y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );

// The filter that matches a node whose focal point is still `focal` (`null`
// is the centre, stored as null or absent). A renditions job settles only the
// nodes it rendered the crops for.
export const sameFocal = (focal: Focal | null | undefined) =>
  focal
    ? { "focalPoint.x": focal.x, "focalPoint.y": focal.y }
    : { focalPoint: null };

// A focal point is kept to a thousandth of the picture: finer than a pixel on
// any rendition, and what the crops' key and the pixels both read.
const FOCAL_STEP = 1000;
export const roundFocal = (focal: Focal): Focal => ({
  x: Math.round(focal.x * FOCAL_STEP) / FOCAL_STEP,
  y: Math.round(focal.y * FOCAL_STEP) / FOCAL_STEP,
});

// The media key the four crops of a blob are stored and served under for a
// focal point (`/media/files/<cropsKey>/<size>`). The centre (`null`) is the
// blob's own key, so the crops made before the point existed keep working;
// any other point is a stable, UUID-shaped hash of the blob and the rounded
// point (`fp-<x>:<y>`): copies at the same point share crops, copies at
// another point have their own.
export function cropsKeyOf(blobKey: string, focal: Focal | null | undefined) {
  if (!focal) return blobKey;
  const { x, y } = roundFocal(focal);
  const h = createHash("sha256")
    .update(`${blobKey}:fp-${x}:${y}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
