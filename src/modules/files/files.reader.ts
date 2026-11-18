import type { FileReader } from "@/core/storage";
import { mayRead } from "./files.access";
import { filesMongo } from "./files.handle";

// Who may read a `files` key through `/media`: the check the app hands to the
// storage routes (`createApp`), so the kernel needs no registry of its own.
export const fileReader: FileReader = (database, read) =>
  mayRead(filesMongo(database), read);
