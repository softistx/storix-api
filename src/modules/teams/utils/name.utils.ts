import { invalidInput } from "@/i18n/fail";

// A name is trimmed; a blank one is refused like a too short one.
export function nameOf(raw: string): string {
  const name = raw.trim();
  if (name === "") {
    throw invalidInput([
      {
        path: "name",
        code: "validation.errors.too-short",
        params: { min: 1 },
      },
    ]);
  }
  return name;
}
