// True when a write was refused by a unique index (MongoDB error 11000): the
// document, or its `_id`, already exists.
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
