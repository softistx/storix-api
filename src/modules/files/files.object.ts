import {
  isMediaKey,
  type MediaBucket,
  mediaPlace,
} from "@softistx/alxia-media";
import { fail } from "@/i18n/fail";
import { keyUnknown } from "./files.errors";

export interface StoredObject {
  size: number;
  mimeType: string;
}

// What the storage holds under a key of the `files` kind in this workspace:
// its size and content type, as the storage reported them. Anything else is
// `key-unknown`, and nothing says which: a malformed key, an object of
// another workspace or of another kind (none lies under this prefix), a key
// never uploaded. No bucket is `storage.errors.unavailable`.
export async function storedObject(
  bucket: MediaBucket | undefined,
  workspaceId: string,
  key: string,
): Promise<StoredObject> {
  if (!bucket) throw fail("storage.errors.unavailable", { status: 503 });
  if (!isMediaKey(key)) throw keyUnknown();
  const place = mediaPlace("files", `workspaces/${workspaceId}`);
  let opened: Awaited<ReturnType<MediaBucket["open"]>>;
  try {
    opened = await bucket.open({ key: place(key) });
  } catch {
    throw fail("storage.errors.unavailable", { status: 503 });
  }
  if (!opened) throw keyUnknown();
  // Only the headers are wanted: stop the body.
  await opened.stream.cancel().catch(() => undefined);
  if (opened.size === undefined || opened.size <= 0) throw keyUnknown();
  return {
    size: opened.size,
    mimeType: mediaType(opened.contentType),
  };
}

// The stored type without its parameters ("text/plain;charset=utf-8" is
// "text/plain"), lower case, as the family and the listing read it.
function mediaType(contentType: string | undefined): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type || "application/octet-stream";
}

// Deletes an object `addFile` refused (over the quota), best effort: one that
// stays is unrecorded and the orphan sweep removes it. Never throws.
export async function discardObject(
  bucket: MediaBucket | undefined,
  workspaceId: string,
  key: string,
): Promise<void> {
  if (!bucket) return;
  try {
    const place = mediaPlace("files", `workspaces/${workspaceId}`);
    await bucket.delete({ key: place(key) });
  } catch (error) {
    console.error(
      `storix-api: could not delete the refused object ${key} of workspace ${workspaceId}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
