import type { MediaBucket } from "@softistx/alxia-media";
import { mediaRoutes } from "@softistx/alxia-media";
import { keyPrefix } from "./storage.access";
import type { MediaRequires } from "./storage.context";
import type { FileReader } from "./storage.keys";
import { mediaKinds } from "./storage.kinds";
import type { UploadLimit } from "./storage.limit";
import { refusalReply } from "./storage.refusal";

// `/media`: `PUT /media/<kind>`, `GET /media/<kind>/<key>[/<size>]`. Mount it
// after the middlewares that add the viewer and the guard (src/app.ts), so a
// request is a workspace member's and every object is under
// `workspaces/<workspaceId>/`. Without a bucket every route answers 503
// `storage.errors.unavailable`.
export function storageRoutes(options: {
  bucket: MediaBucket | undefined;
  limit: UploadLimit;
  fileReader: FileReader;
}) {
  const kinds = mediaKinds({
    limit: options.limit,
    fileReader: options.fileReader,
    available: options.bucket !== undefined,
  });
  return mediaRoutes<MediaRequires>(kinds, {
    // Never reached without a bucket: the kinds refuse first.
    bucket: options.bucket ?? (unconfigured as MediaBucket),
    keyPrefix,
    refusal: refusalReply,
  });
}

const unconfigured = {} as unknown;
