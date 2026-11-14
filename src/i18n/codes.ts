import { defineCodes } from "@alxia/i18n";

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
// are the plan's; the next five are the codes of @nxgt/graphql-validation's
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

// The account flows (src/core/identity). A refusal says what the client can
// act on, never which of janus's reasons it was: an unknown address, a
// deactivated account and a wrong password are one `invalid-credentials`.
export const identity = defineCodes("identity", [
  "invalid-credentials",
  "email-unverified",
  "token-invalid",
  "second-factor-invalid",
  "second-factor-state",
  "unavailable",
]);

// The workspaces (src/core/workspaces). `not-found` is also the answer for a
// workspace the caller is not a member of, so none is told from an unknown one.
export const workspaces = defineCodes("workspaces", [
  "not-found",
  // 400: a workspace operation without the `x-storix-workspace` header.
  "workspace-required",
  "slug-taken",
  // 409: the change would leave the workspace without an owner.
  "last-owner",
]);

// The memberships of a workspace (src/core/members).
export const members = defineCodes("members", ["not-found"]);

// Every code the API answers with, in module order: the inventory. tsc refuses
// a code that is not in it (`fail`, `FieldIssue`), the coverage spec requires
// a message for each in every shipped language and a row in CONTEXT.md, and
// that every registered module's `codes` are in it. A slice that adds a module
// with codes adds its `codes` here, beside the manifest's.
export const errorCodes = [
  ...auth,
  ...validation,
  ...identity,
  ...workspaces,
  ...members,
] as const;

export type ErrorCode = (typeof errorCodes)[number];
