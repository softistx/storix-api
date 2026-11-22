import { invalidInput } from "@/i18n/fail";
import { checkName } from "../rules";

// A name is trimmed and checked; a refused one is a field issue of `name`.
export function nameOf(raw: string): string {
  const checked = checkName(raw);
  if ("issue" in checked) {
    throw invalidInput([
      {
        path: "name",
        code: checked.issue,
        ...(checked.issue === "validation.errors.too-short" && {
          params: { min: 1 },
        }),
      },
    ]);
  }
  return checked.name;
}
