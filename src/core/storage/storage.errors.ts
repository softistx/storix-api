import { defineCodes } from "@softistx/alxia-i18n";

// The object store behind /media (src/core/storage). The refusals of the media
// routes, in the GraphQL error shape.
export const storage = defineCodes("storage", [
  // 413: the upload is larger than its kind allows (`params.limitMib`).
  "too-large",
  // 415: the content type is not one the kind accepts, or its first bytes are
  // not the declared type's.
  "unsupported-type",
  // 400: the upload has no bytes.
  "empty",
  // 429: too many uploads (`params.seconds`, and `extensions.retryAfter`).
  "rate-limited",
  // 503: the store did not answer, or is not configured.
  "unavailable",
  // 422: a picture could not be decoded or made into its sizes.
  "unprocessable",
  // 408: the client sent nothing for too long.
  "stalled",
  // 404: no such file in the workspace (also the answer for a refused reader).
  "not-found",
  // 416: the Range starts past the end of the file.
  "range-not-satisfiable",
  // 400: the body ended short of its declared length, or was cut.
  "interrupted",
]);
