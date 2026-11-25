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
