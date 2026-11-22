import { defineCodes } from "@softistx/alxia-i18n";
import { fail } from "@/i18n/fail";

// Recording uploaded files (src/modules/files).
export const files = defineCodes("files", [
  // 400 (field `key`): the key names no object that can be recorded: it is not
  // a media key, no object of the `files` kind lies under it in this workspace
  // (another workspace's key and another kind's are the same), or a file
  // already holds it.
  "key-unknown",
  // 400 (field `id`): `updateFile` or `setFocalPoint` named a folder.
  "not-a-file",
  // 409: the copied folder, with what it holds, has more than 5,000 nodes.
  "copy-too-large",
  // 400 (field `id`): `setFocalPoint` named a file that is not a JPEG, PNG or
  // WebP picture: only these have crops.
  "not-renderable",
  // 400 (field `focalPoint`): a coordinate that is not a number from 0 to 1.
  "invalid-focal",
]);

// The versions of a file (src/modules/files, `services/versions*.service.ts`).
export const versions = defineCodes("versions", [
  // 404: the file has no version with this id (an unknown id, another file's
  // version and a malformed id are one answer).
  "not-found",
  // 409: the operation names the current version: it is never deleted, and
  // restoring it would change nothing.
  "is-current",
]);

export const keyUnknown = () =>
  fail("files.errors.key-unknown", { status: 400, field: "key" });
export const notAFile = () =>
  fail("files.errors.not-a-file", { status: 400, field: "id" });
export const notRenderable = () =>
  fail("files.errors.not-renderable", { status: 400, field: "id" });
export const invalidFocal = () =>
  fail("files.errors.invalid-focal", { status: 400, field: "focalPoint" });
export const copyTooLarge = () =>
  fail("files.errors.copy-too-large", { status: 409 });

export const versionNotFound = () =>
  fail("versions.errors.not-found", { status: 404, field: "versionId" });
export const isCurrent = () =>
  fail("versions.errors.is-current", { status: 409, field: "versionId" });
