import { createHash } from "node:crypto";

// A catalogue as @alxia/i18n reads it: the dotted code as a nested tree
// (`auth.errors.forbidden` is `{ auth: { errors: { forbidden } } }`).
export type Tree = { [key: string]: string | Tree };

export interface Row {
  code: string;
  language: string;
  text: string;
}

const unsafe = new Set(["__proto__", "constructor", "prototype"]);

const clash = (code: string) =>
  new TypeError(`translations: "${code}" is both a message and a branch`);

// The catalogue of one language: the rows that have a text in it. A code that
// is both a message and the start of another code is refused: the tree cannot
// hold both.
export function catalogueOf(rows: readonly Row[], language: string): Tree {
  const root: Tree = {};
  for (const row of rows) {
    if (row.language !== language) continue;
    const path = row.code.split(".");
    if (path.some((step) => unsafe.has(step))) throw clash(row.code);
    const leaf = path.pop() as string;
    let branch = root;
    for (const step of path) {
      const next = branch[step] ?? {};
      if (typeof next === "string") throw clash(row.code);
      branch[step] = next;
      branch = next;
    }
    if (branch[leaf] !== undefined) throw clash(row.code);
    branch[leaf] = row.text;
  }
  return root;
}

// The text a dotted code has in a tree, or undefined (a branch is no message).
export function messageIn(tree: Tree, code: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const step of code.split(".")) {
    if (typeof node !== "object") return undefined;
    node = node[step];
  }
  return typeof node === "string" ? node : undefined;
}

export interface ErrorMessageView {
  code: string;
  message: string;
}

// Every code's message, in the order of `codes`, each from the first tree of
// the chain that has it (the language's, then the fallback's); a code none has
// is left out (coverage.spec.ts keeps that from happening).
export function messagesOf(
  chain: readonly Tree[],
  codes: readonly string[],
): ErrorMessageView[] {
  const messages: ErrorMessageView[] = [];
  for (const code of codes) {
    for (const tree of chain) {
      const message = messageIn(tree, code);
      if (message === undefined) continue;
      messages.push({ code, message });
      break;
    }
  }
  return messages;
}

// JSON with the keys of every object sorted: the same tree is the same string
// whatever the order it was built in.
export function stableJson(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
  return `{${entries.join(",")}}`;
}

// The version of what a language serves: a digest of its chain's trees. It
// changes when any text of them does and not otherwise, so it is the same
// after a restart and on every instance.
export function versionOf(chain: readonly Tree[]): string {
  return createHash("sha256")
    .update(stableJson(chain))
    .digest("hex")
    .slice(0, 32);
}
