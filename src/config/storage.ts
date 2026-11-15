import { createUploadLimit } from "../core/storage";
import { redis } from "./redis";

export { bucket } from "./bucket";

// Uploads per account and workspace, over the one Redis; closed when it fails.
export const uploadLimit = createUploadLimit(redis);
