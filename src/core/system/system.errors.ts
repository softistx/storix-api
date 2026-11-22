import { defineCodes } from "@softistx/alxia-i18n";

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
