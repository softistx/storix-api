import { ObjectId } from "mongodb";
import { fail } from "@/i18n/fail";

// A cursor of a listing: the sort key of the last node handed out, bound to
// the listing it came from (the folder, the filter and the sort). A cursor of
// another listing, or one that is not ours, is `validation.errors.invalid-cursor`.
// It is encoded, not signed: it names no data the caller cannot read, only
// positions in their own listing.

type Value = string | number | boolean | null;

const invalidCursor = () =>
  fail("validation.errors.invalid-cursor", { status: 400, field: "after" });

const bindOf = (scope: string) =>
  new Bun.CryptoHasher("sha256").update(scope).digest("hex").slice(0, 16);

// A sort key part as the cursor carries it: dates and ids as tagged strings.
const encodeValue = (value: unknown): Value => {
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (value instanceof ObjectId) return `o:${value.toHexString()}`;
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return `s:${String(value)}`;
};

const decodeValue = (value: Value): unknown => {
  if (value === null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") throw invalidCursor();
  const tag = value.slice(0, 2);
  const rest = value.slice(2);
  if (tag === "d:") {
    const date = new Date(rest);
    if (Number.isNaN(date.getTime())) throw invalidCursor();
    return date;
  }
  if (tag === "o:") {
    if (!ObjectId.isValid(rest)) throw invalidCursor();
    return new ObjectId(rest);
  }
  if (tag === "s:") return rest;
  throw invalidCursor();
};

export function encodeCursor(scope: string, values: readonly unknown[]) {
  return Buffer.from(
    JSON.stringify({ b: bindOf(scope), v: values.map(encodeValue) }),
  ).toString("base64url");
}

export function decodeCursor(
  scope: string,
  cursor: string,
  length: number,
): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const { b, v } = (parsed ?? {}) as { b?: unknown; v?: unknown };
  if (b !== bindOf(scope) || !Array.isArray(v) || v.length !== length) {
    throw invalidCursor();
  }
  return (v as Value[]).map(decodeValue);
}
