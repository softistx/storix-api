import { defineMediaKind } from "@alxia/media";
import { withImageRendition } from "@alxia/media/image";
import { accessOf, authorizeRead, authorizeWrite } from "./storage.access";
import type { MediaRequires } from "./storage.context";
import type { UploadLimit } from "./storage.limit";

const MIB = 1024 * 1024;

export const FILES_MAX_BYTES = 95 * MIB;
export const AVATARS_MAX_BYTES = 10 * MIB;

// The kinds (plan §3.4). `files` takes any type: known signatures are sniffed
// and a type outside the inline-safe list is served as an attachment.
// Every use revalidates (`private, no-cache`): a reader can lose access.
// `files` has no `sizes` yet: @alxia/media takes none with `accept: '*'`
// (storix-api#28, "Assumed").
export function mediaKinds(options: {
  limit: UploadLimit;
  // False when no bucket is configured: every route answers 503.
  available: boolean;
}) {
  const write = async (ctx: MediaRequires) =>
    options.available ? authorizeWrite(ctx) : { code: "unavailable" };
  const read = async (ctx: MediaRequires) =>
    options.available ? authorizeRead(ctx) : { code: "unavailable" };
  const throttle = async (ctx: MediaRequires) => {
    const access = await accessOf(ctx);
    if (!access.ok) return true;
    const wait = await options.limit(
      `${access.accountId}:${access.workspaceId}`,
    );
    return wait === 0 ? true : wait;
  };
  return [
    defineMediaKind<MediaRequires>({
      name: "files",
      accept: "*",
      maxBytes: FILES_MAX_BYTES,
      authorizeWrite: write,
      authorizeRead: read,
      throttle,
      cacheControl: "private, no-cache",
    }),
    defineMediaKind<MediaRequires>({
      name: "avatars",
      accept: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: AVATARS_MAX_BYTES,
      authorizeWrite: write,
      authorizeRead: read,
      throttle,
      cacheControl: "private, no-cache",
      keepOriginal: false,
      // Sizes are named by their side in pixels: 64 (small) and 256 (medium).
      ...withImageRendition({ sizes: [256, 64], minSide: 64 }),
    }),
  ];
}
