// What a blob holds in the counters, by where it stands (see `BlobState` in
// the accounting service).
export interface Held {
  size: number;
  state: "none" | "live" | "trash" | "versions";
}

// The three counted figures of one blob: `bytes` unless released,
// `versionBytes` when only version rows hold it, `trashBytes` when only
// trashed nodes do.
export const counted = (held: Held | undefined) => ({
  bytes: held && held.state !== "none" ? held.size : 0,
  versionBytes: held?.state === "versions" ? held.size : 0,
  trashBytes: held?.state === "trash" ? held.size : 0,
});
