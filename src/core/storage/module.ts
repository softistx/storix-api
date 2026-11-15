import { defineModule } from "@alxia/modules";
import { storage as codes } from "@/i18n/codes";

// The object store behind `/media`: no collection, no GraphQL field, only the
// refusal codes of the routes (the routes themselves are mounted by
// src/app.ts). Files are recorded by the `files` module (slice A9).
export const storageModule = defineModule({
  name: "storage",
  codes,
});
