import { defineCodes } from "./define-codes";

// Who is asking: shared by every module, so declared here (plan §3.13).
export const auth = defineCodes("auth", [
  "unauthenticated",
  "forbidden",
  "step-up-required",
  "second-factor-required",
  "rate-limited",
  // 401: an API key on a path it may not reach.
  "api-key-not-accepted",
  "client-header-required",
]);

// Malformed input: shared by every module, so declared here. The first five
// are the plan's; the next six are the codes of @nxgt/graphql-validation's
// `FIELD_CODES` (what `fieldIssueOf` answers for a Zod issue), which a
// `invalid-input` error lists per field (the coverage spec keeps them in sync).
export const validation = defineCodes("validation", [
  "invalid-input",
  "invalid",
  "out-of-range",
  "invalid-cursor",
  "invalid-filter",
  "too-short",
  "too-long",
  "too-few",
  "too-many",
  "invalid-format",
]);

// Every code the API answers with, in module order: the inventory. tsc refuses
// a code that is not in it (`fail`, `FieldIssue`), the coverage spec requires
// a message for each in every shipped language and a row in CONTEXT.md, and
// that every registered module's `codes` are in it. A slice that adds a module
// with codes adds its `codes` here, beside the manifest's.
export const errorCodes = [...auth, ...validation] as const;

export type ErrorCode = (typeof errorCodes)[number];
