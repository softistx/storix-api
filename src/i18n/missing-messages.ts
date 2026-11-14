import type { Row } from "../core/translations/translations.catalogue";

// The `code (language)` pairs that have no message: what coverage.spec.ts
// requires to be empty.
export function missingMessages(
  codes: readonly string[],
  rows: readonly Row[],
  languages: readonly string[],
): string[] {
  const have = new Set(rows.map((row) => `${row.code} (${row.language})`));
  return codes.flatMap((code) =>
    languages
      .filter((language) => !have.has(`${code} (${language})`))
      .map((language) => `${code} (${language})`),
  );
}
