import type { FileReader } from "@/core/storage";
import { nodesMongo } from "@/modules/nodes/public";
import { mayRead } from "./files.service";

// Who may read a `files` key through `/media`: the check the app hands to the
// storage routes (`createApp`), so the kernel needs no registry of its own.
export const fileReader: FileReader = (database, read) =>
  mayRead(nodesMongo(database), read);
