// The quota thresholds that notify: 85 % and 95 %. A write that would pass the
// quota (100 %, "full") is refused (`quotas.errors.exceeded`), so usage reaches
// the quota but never passes it; that refusal is not one of these thresholds.
export const QUOTA_LEVELS = [85, 95] as const;
export type QuotaLevel = 0 | (typeof QUOTA_LEVELS)[number];

// The highest threshold the usage has reached, 0 under the first. Integer
// arithmetic (`bytes * 100 >= quota * level`): no rounding at the edge.
export function levelOf(bytes: number, quotaBytes: number): QuotaLevel {
  if (quotaBytes <= 0) return 0;
  let reached: QuotaLevel = 0;
  for (const level of QUOTA_LEVELS) {
    if (bytes * 100 >= quotaBytes * level) reached = level;
  }
  return reached;
}
