import {
  isMediaKey,
  type MediaBucket,
  mediaPlace,
} from "@softistx/alxia-media";
import { ImageError, renderImage } from "@softistx/image";
import { type Handler, JobError } from "@softistx/redis";
import { parseRenditionJobId, type renditionJob } from "@/queues/renditions";
import type { FilesMongo } from "../models";
import {
  CROP_SIZES,
  CROP_SPECS,
  cropBox,
  cropsKeyOf,
  type Focal,
  PREVIEW_SIZES,
  RENDITION_SIDES,
  type RenditionKind,
  renditionKindOf,
  roundFocal,
  sameFocal,
  targetSize,
} from "../rules";
import { fitSide, limits, type MadeRendition, makeFromPdf } from "../utils";
import { pruneCrops, storeRenditions } from "./crops.service";

export interface MakeOptions {
  signal?: AbortSignal | undefined;
  // The picture's focal point; null is the centre. Only the crops read it.
  focal?: Focal | null | undefined;
  // Only the four crops: what a move of the focal point redoes.
  cropsOnly?: boolean | undefined;
}

// Every size of a file's bytes with every piece of metadata stripped: the
// previews as WebP, and for a picture the four crops as JPEG, centred on the
// focal point. `ImageError` (undecodable, too large, not that type) says the
// file itself cannot be rendered: retrying cannot help.
export async function makeRenditions(
  bytes: Uint8Array,
  kind: RenditionKind,
  options: MakeOptions = {},
): Promise<MadeRendition[]> {
  const { signal } = options;
  if (kind === "pdf")
    return options.cropsOnly ? [] : makeFromPdf(bytes, signal);
  // The upright size, which EXIF orientation may swap, is read by a first
  // render of one pixel.
  const { source } = await renderImage(bytes, {
    width: 1,
    height: 1,
    format: "webp",
    ...limits(signal),
  });
  const made: MadeRendition[] = [];
  for (const size of options.cropsOnly ? [] : PREVIEW_SIZES) {
    const target = fitSide(source.width, source.height, RENDITION_SIDES[size]);
    const image = await renderImage(bytes, {
      ...target,
      format: "webp",
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/webp" });
  }
  for (const size of CROP_SIZES) {
    const spec = CROP_SPECS[size];
    const box = cropBox(source, spec.aspect, options.focal ?? null);
    const target = targetSize(size, box);
    const image = await renderImage(bytes, {
      crop: { x: box.x, y: box.y, width: box.width, height: box.height },
      ...target,
      format: "jpeg",
      quality: spec.quality,
      ...limits(signal),
    });
    made.push({ size, bytes: image.bytes, contentType: "image/jpeg" });
  }
  return made;
}

// What the worker runs for each job of the `renditions` queue (plan §3.14):
// read the original, make `thumb` and `preview` and the four crops (centred
// on the job's focal point; a `crops` job redoes the crops only), store them where
// `GET /media/files/<key>/<size>` serves them (`mediaPlace`), and move the
// node from `PROCESSING` to `READY`. Everything the job writes is safe to
// repeat, so a retry starts over.
//
// A file that cannot be rendered (undecodable, too large, an original that is
// gone) is `FAILED` at once: retrying cannot help. Any other failure (the
// store or the database is away) is retried with the queue's backoff and
// `FAILED` when the last attempt is spent. `FAILED` covers the previews only:
// the original stays readable and downloadable.
//
// A `FAILED` file may still serve a size that was stored before the failure
// (the sizes are rendered first, then stored one after the other, so a store
// that fails midway leaves the first ones; a crops job that fails leaves the
// previous crops). That is kept on purpose: each stored size is a valid
// rendition of this very original, `/media` serves it, and deleting it would
// only add a second way to fail. `renditions` (GraphQL) lists nothing while
// the file is not `READY`.

export interface RenditionsWorkDeps {
  // The workspace's database, typed for the files module.
  mongoOf(workspaceId: string): Promise<FilesMongo>;
  bucket: MediaBucket;
}

// The original is not in the store any more.
class OriginalMissing extends Error {}

// Every node of the blob (a copy shares it) still `PROCESSING` takes the
// status. Silent: the nodes' versions stay what a client holds.
//
// `authoritative` (a job that succeeded) also settles nodes that were given up
// on (`FAILED`, by the stuck sweep or by a failed job of the same point): the
// sizes are stored, so a later success heals them. `READY` resets the requeue
// counter.
//
// `rendered` (the focal point the job's crops were made for, `null` for the
// centre) settles only the nodes at that point: a node moved to another point
// meanwhile stays `PROCESSING` for the job `setFocalPoint` queued for it.
//
// A crops job (`scope` "crops") settles `cropsStatus` alone and leaves the
// file's `status` as it is; a full job settles `status` and clears
// `cropsStatus` (its crops are the current ones).
async function setStatus(
  mongo: FilesMongo,
  key: string,
  status: "READY" | "FAILED",
  options: {
    scope?: "file" | "crops";
    authoritative?: boolean;
    rendered?: { focal: Focal | null };
  } = {},
) {
  const { scope = "file", authoritative = false, rendered } = options;
  const field = scope === "crops" ? "cropsStatus" : "status";
  await mongo.db.nodes.updateMany(
    {
      blobKey: key,
      ...(rendered && sameFocal(rendered.focal)),
      [field]: authoritative ? { $in: ["PROCESSING", "FAILED"] } : "PROCESSING",
    },
    {
      [field]: status,
      // The crops now served are the ones made for this point.
      ...(status === "READY" &&
        rendered && { cropsKey: cropsKeyOf(key, rendered.focal) }),
      ...(status === "READY" && {
        renditionRequeues: 0,
        ...(scope === "file" && { cropsStatus: null }),
      }),
    },
    { audit: false },
  );
}

// A job that is running keeps its nodes out of the stuck sweep (`requeueStuck`
// looks at `renditionsAt`): the handler touches them when it starts and again
// before it stores, so a slow render is never queued a second time. The beat
// comes at the phase boundaries only (nothing beats inside the read, the
// render or the stores), so each phase must stay well under `STUCK_AFTER_MS`.
// A raw write, as the sweep's own (no version, no audit), and best effort: a
// database blip is logged and never fails the job nor sets it `FAILED`.
async function touch(mongo: FilesMongo, key: string) {
  try {
    await mongo.db.nodes.raw.updateMany(
      {
        blobKey: key,
        $or: [{ status: "PROCESSING" }, { cropsStatus: "PROCESSING" }],
      },
      { $set: { renditionsAt: new Date() } },
    );
  } catch (error) {
    console.warn(
      `renditions ${key}: heartbeat failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function readOriginal(
  bucket: MediaBucket,
  workspaceId: string,
  key: string,
): Promise<Uint8Array> {
  const place = mediaPlace("files", `workspaces/${workspaceId}`);
  const opened = await bucket.open({ key: place(key) });
  if (!opened) throw new OriginalMissing(`the original of ${key} is gone`);
  return new Uint8Array(await new Response(opened.stream).arrayBuffer());
}

// A job that failed for good without its handler reaching its own `FAILED`
// (the process died on the last attempt, the lease ran out): the worker's
// `failed` event calls it so that the node is never left `PROCESSING`.
export async function markRenditionsFailed(
  deps: Pick<RenditionsWorkDeps, "mongoOf">,
  jobId: string,
) {
  const job = parseRenditionJobId(jobId);
  if (!job) return;
  // The id does not say which job it was: whichever is pending gives up.
  const mongo = await deps.mongoOf(job.workspaceId);
  await setStatus(mongo, job.key, "FAILED");
  await setStatus(mongo, job.key, "FAILED", { scope: "crops" });
}

export function renditionsHandler(
  deps: RenditionsWorkDeps,
): Handler<typeof renditionJob> {
  return async ({ data, attempt, attempts, signal }) => {
    const { workspaceId, key, crops } = data;
    const scope = crops === true ? "crops" : "file";
    const mongo = await deps.mongoOf(workspaceId);
    const node = await mongo.db.nodes.findFirst({ blobKey: key });
    const kind = node?.mimeType ? renditionKindOf(node.mimeType) : null;
    // Deleted since, or a type with no previews: nothing to make.
    if (!node || !kind || !isMediaKey(key)) {
      if (node) await setStatus(mongo, key, "READY", { scope });
      return;
    }
    // The point the job was queued for; a job queued before the field reads
    // the node's.
    const focal =
      data.focalPoint === undefined ? node.focalPoint : data.focalPoint;
    try {
      await touch(mongo, key);
      const bytes = await readOriginal(deps.bucket, workspaceId, key);
      const made = await makeRenditions(bytes, kind, {
        signal,
        focal: focal && roundFocal(focal),
        cropsOnly: crops === true,
      });
      await touch(mongo, key);
      await storeRenditions(
        { ...deps, mongo },
        { workspaceId, key, focal },
        made,
      );
    } catch (error) {
      const permanent =
        error instanceof ImageError || error instanceof OriginalMissing;
      // A crops job gives up the nodes at its own point only.
      if (permanent || attempt >= attempts)
        await setStatus(mongo, key, "FAILED", {
          scope,
          ...(scope === "crops" && { rendered: { focal: focal ?? null } }),
        });
      if (permanent) {
        throw new JobError(
          error instanceof Error ? error.message : "unrenderable",
          { retry: false },
        );
      }
      throw error;
    }
    await setStatus(mongo, key, "READY", {
      scope,
      authoritative: true,
      rendered: { focal: focal ?? null },
    });
    await pruneCrops({ ...deps, mongo }, workspaceId, key).catch((error) =>
      console.warn(`renditions ${key}: crops not pruned: ${error}`),
    );
  };
}
