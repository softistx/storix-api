import type { Focal } from "./crops.rules";

// A coordinate is a number from 0 to 1 (fractions of the picture).
export const isFocal = (focal: Focal) =>
  [focal.x, focal.y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
