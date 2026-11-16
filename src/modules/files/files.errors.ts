import { fail } from "@/i18n/fail";

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
