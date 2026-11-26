/**
 * Old unrecorded keys of a workspace this many or more are not swept when no
 * blob holds a ref at all, or when they outnumber `ORPHAN_BRAKE_RATIO` of the
 * recorded blobs (a wrong or stale database against the real bucket).
 */
export const ORPHAN_BRAKE = 10;
/** Share of the recorded blobs (`refs` above 0) the unrecorded keys may reach. */
export const ORPHAN_BRAKE_RATIO = 0.5;
/** A `refs` 0 blob is removed only once released (or claimed) this long ago. */
export const RELEASE_GRACE_MS = 24 * 60 * 60_000;
/** A `lastModified` later than now plus this stops the workspace (clock skew). */
export const CLOCK_SKEW_MS = 5 * 60_000;
/**
 * That many (or more) removable `refs` 0 blobs, over twice the recorded ones,
 * stop the released step: a mass release is not normal.
 */
export const RELEASED_BRAKE = 100;

// The orphan brake: enough unrecorded keys, and either no recorded blob or
// more unrecorded keys than the ratio of the recorded ones.
export function orphanBrake(unrecorded: number, recorded: number): boolean {
  return (
    unrecorded >= ORPHAN_BRAKE &&
    (recorded === 0 || unrecorded > ORPHAN_BRAKE_RATIO * recorded)
  );
}
