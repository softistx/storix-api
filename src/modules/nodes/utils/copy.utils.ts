const MAX_NAME = 255;

// `report (2).pdf` from `report.pdf`: the number goes before the last
// extension; a name with none, or that only starts with a dot, takes it last.
export function copyName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const [stem, extension] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const suffix = ` (${n})${extension}`;
  return `${stem.slice(0, Math.max(1, MAX_NAME - suffix.length))}${suffix}`;
}
