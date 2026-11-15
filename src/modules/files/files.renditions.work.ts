import { isMediaKey, type MediaBucket, mediaPlace } from "@alxia/media";
import { ImageError } from "@softistx/image";
import { type Handler, JobError } from "@softistx/redis";
import type { renditionJob } from "@/queues/renditions";
import { renditionKindOf } from "./files.renditions";
import { makeRenditions } from "./files.renditions.make";
import type { FilesMongo } from "./files.service";

// What the worker runs for each job of the `renditions` queue (plan §3.14):
// read the original, make `thumb` and `preview`, store them where
// `GET /media/files/<key>/<size>` serves them (`mediaPlace`), and move the
// node from `PROCESSING` to `READY`. Everything the job writes is safe to
// repeat, so a retry starts over.
//
// A file that cannot be rendered (undecodable, too large, an original that is
// gone) is `FAILED` at once: retrying cannot help. Any other failure (the
// store or the database is away) is retried with the queue's backoff and
// `FAILED` when the last attempt is spent. `FAILED` covers the previews only:
// the original stays readable and downloadable.

export interface RenditionsWorkDeps {
  // The workspace's database, typed for the files module.
  mongoOf(workspaceId: string): Promise<FilesMongo>;
  bucket: MediaBucket;
}

// The original is not in the store any more.
class OriginalMissing extends Error {}

// Every node of the blob (a copy shares it) still `PROCESSING` takes the
// status. Silent: the nodes' versions stay what a client holds.
async function setStatus(
  mongo: FilesMongo,
  key: string,
  status: "READY" | "FAILED",
) {
  await mongo.db.nodes.updateMany(
    { blobKey: key, status: "PROCESSING" },
    { status },
    { audit: false },
  );
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

export function renditionsHandler(
  deps: RenditionsWorkDeps,
): Handler<typeof renditionJob> {
  return async ({ data, attempt, attempts, signal }) => {
    const { workspaceId, key } = data;
    const mongo = await deps.mongoOf(workspaceId);
    const node = await mongo.db.nodes.findFirst({ blobKey: key });
    const kind = node?.mimeType ? renditionKindOf(node.mimeType) : null;
    // Deleted since, or a type with no previews: nothing to make.
    if (!node || !kind || !isMediaKey(key)) {
      if (node) await setStatus(mongo, key, "READY");
      return;
    }
    try {
      const bytes = await readOriginal(deps.bucket, workspaceId, key);
      const place = mediaPlace("files", `workspaces/${workspaceId}`);
      for (const made of await makeRenditions(bytes, kind, signal)) {
        await deps.bucket.put({ key: place(key, made.size) }, made.bytes, {
          type: made.contentType,
        });
      }
    } catch (error) {
      const permanent =
        error instanceof ImageError || error instanceof OriginalMissing;
      if (permanent || attempt >= attempts)
        await setStatus(mongo, key, "FAILED");
      if (permanent) {
        throw new JobError(
          error instanceof Error ? error.message : "unrenderable",
          { retry: false },
        );
      }
      throw error;
    }
    await setStatus(mongo, key, "READY");
  };
}
