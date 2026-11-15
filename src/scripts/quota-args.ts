const UNITS: Record<string, number> = {
  "": 1,
  b: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

// "21474836480", "20GiB", "512MiB": a positive whole number of bytes, or
// `undefined` for anything else (a decimal, a negative, an unknown unit).
export function parseBytes(input: string | undefined): number | undefined {
  const match = /^(\d+)\s*([a-z]*)$/i.exec(input?.trim() ?? "");
  const unit = UNITS[(match?.[2] ?? "").toLowerCase()];
  if (!match || unit === undefined) return undefined;
  const bytes = Number(match[1]) * unit;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}
