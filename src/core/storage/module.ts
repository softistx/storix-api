import { defineModule } from "@softistx/alxia-modules";
import { storage as codes } from "./storage.errors";

// The object store behind `/media`: no collection, no GraphQL field, only the
// refusal codes of the routes (the routes themselves are mounted by
// src/app.ts). Files are recorded by the `files` module, which tells the routes
// which keys a caller may read (storage.keys.ts).
export const storageModule = defineModule({
  name: "storage",
  dependsOn: ["workspaces"],
  codes,
});
