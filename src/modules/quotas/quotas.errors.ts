import { defineCodes } from "@softistx/alxia-i18n";

// The workspace's storage quota (src/core/workspaces, src/modules/quotas).
export const quotas = defineCodes("quotas", [
  // 413: the file does not fit in what the workspace has left. Raised by the
  // `/media` PUT from the declared length, before the body is read, and by
  // `addFile`, which decides.
  "exceeded",
]);
