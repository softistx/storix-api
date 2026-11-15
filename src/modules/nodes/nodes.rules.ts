// The rules of the tree that need no database (plan §3.3).

// A folder's depth counts from its root, which is depth 1: a root holds
// folders down to depth 16.
export const MAX_DEPTH = 16;

// A folder move rewrites the `ancestors` of its subtree in one transaction, up
// to this many nodes; above it the move is refused (`nodes.errors.move-too-large`).
export const MAX_MOVE_NODES = 5_000;

// What `moveNodes` takes at once.
export const MAX_MOVE_IDS = 100;

export const ROOT_NAME = "My files";

// A name is trimmed. It may not be blank, hold a `/` or `\` (they would be
// read as a path), a control character, or be `.` or `..`. Answers the
// trimmed name, or the reason it is refused.
export function checkName(raw: string):
  | { name: string }
  | {
      issue: "validation.errors.too-short" | "validation.errors.invalid-format";
    } {
  const name = raw.trim();
  if (name === "") return { issue: "validation.errors.too-short" };
  if (
    name === "." ||
    name === ".." ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the rule
    /[/\\\u0000-\u001f\u007f]/.test(name)
  ) {
    return { issue: "validation.errors.invalid-format" };
  }
  return { name };
}
