// The rules of a file's tags and metadata that need no database.

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 50;
export const MAX_META_BYTES = 16_384;

// A tag is trimmed and lower case; an empty one is dropped and a repeat
// counts once, in the order given. Answers the tags, or the field issue.
export function checkTags(raw: readonly string[]):
  | { tags: string[] }
  | {
      issue: "validation.errors.too-long" | "validation.errors.too-many";
      max: number;
    } {
  const tags = [
    ...new Set(raw.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
  if (tags.length > MAX_TAGS) {
    return { issue: "validation.errors.too-many", max: MAX_TAGS };
  }
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    return { issue: "validation.errors.too-long", max: MAX_TAG_LENGTH };
  }
  return { tags };
}

// Free metadata is a JSON object of at most 16 KiB once written.
export const metaFits = (meta: unknown) =>
  typeof meta === "object" &&
  meta !== null &&
  !Array.isArray(meta) &&
  new TextEncoder().encode(JSON.stringify(meta)).length <= MAX_META_BYTES;
