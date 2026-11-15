import { defineMediaKind, type MediaUploadIntent } from "@alxia/media";
import { withImageRendition } from "@alxia/media/image";
import { hasRoom, type WorkspacesMongo } from "@/core/workspaces";
import {
  accessOf,
  authorizeFileRead,
  authorizeRead,
  authorizeWrite,
} from "./storage.access";
import type { MediaRequires } from "./storage.context";
import type { UploadLimit } from "./storage.limit";

const MIB = 1024 * 1024;

export const FILES_MAX_BYTES = 95 * MIB;
// The sizes of a file the worker makes (plan §3.4): `thumb` and `preview`, then
// the four crops centred on the focal point. Kept equal to the worker's
// `RENDITION_SIZES` (src/modules/files/files.renditions.ts) by a spec.
export const FILES_SIZES = [
  "thumb",
  "preview",
  "square",
  "portrait",
  "story",
  "landscape",
] as const;
export const AVATARS_MAX_BYTES = 10 * MIB;

// The kinds (plan §3.4). `files` takes any type: known signatures are sniffed
// and a type outside the inline-safe list is served as an attachment.
// Every use revalidates (`private, no-cache`): a reader can lose access.
// Only `files` is counted against the quota: an avatar is not recorded as a
// file and weighs at most 10 MiB.
// `files` names its sizes (`thumb`, `preview` and the four crops) and the worker writes them
// (src/modules/files/files.renditions.work.ts): @alxia/media serves
// `GET /media/files/<key>/<size>` once one is stored, a 404 before.
export function mediaKinds(options: {
  limit: UploadLimit;
  // False when no bucket is configured: every route answers 503.
  available: boolean;
}) {
  const write = async (ctx: MediaRequires) =>
    options.available ? authorizeWrite(ctx) : { code: "unavailable" };
  const read = async (ctx: MediaRequires) =>
    options.available ? authorizeRead(ctx) : { code: "unavailable" };
  const readFile = async (ctx: MediaRequires, key: string) =>
    options.available ? authorizeFileRead(ctx, key) : { code: "unavailable" };
  // The workspace quota, from the declared length and before the body is read
  // (so nothing is stored). A body that declares no length is counted at the
  // kind's largest. `addFile` decides for good; this only spares the upload.
  const quota = async (ctx: MediaRequires, upload: MediaUploadIntent) => {
    const access = await accessOf(ctx);
    if (!access.ok) return true;
    const needed = upload.declared ?? FILES_MAX_BYTES;
    const fits = await hasRoom(
      ctx.tenancy.core as WorkspacesMongo,
      access.workspaceId,
      needed,
    );
    return fits ? true : { code: "quota_exceeded", status: 413 };
  };
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
      sizes: FILES_SIZES,
      maxBytes: FILES_MAX_BYTES,
      authorizeWrite: write,
      authorizeRead: readFile,
      throttle,
      quota,
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
