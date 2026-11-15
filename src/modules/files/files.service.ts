import type { MediaBucket } from "@alxia/media";
import type { CollectionsOf, ModuleHandle } from "@alxia/modules";
import { ConflictError, type Mongo } from "@softistx/mongo";
import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  insertFile,
  lockTree,
  type NodeDoc,
  type NodesMongo,
  named,
  type OnConflict,
} from "@/modules/nodes/public";
import { renditionJobId } from "@/queues/renditions";
import { keyUnknown } from "./files.errors";
import { discardObject, storedObject } from "./files.object";
import { type RenditionsQueue, renditionKindOf } from "./files.renditions";

// The module's handle on a workspace's database: its own collection, and the
// nodes it records files in.
export type FilesMongo = ModuleHandle<
  "files",
  Mongo<{ collections: CollectionsOf }>
>;

// A key that a blob already holds, raised inside the transaction so that the
// node's own `ConflictError` (`name-taken`) is not mistaken for it.
class KeyRecorded extends Error {}

// Tries `KEEP_BOTH` again when a writer took the free name first.
const ATTEMPTS = 3;

// Records an uploaded object as a file under a folder of the caller's tree
// (plan §3.5): the object must lie under this workspace's `files` prefix and
// no blob may hold its key yet; its type and size are the storage's. The blob
// and the node are one transaction, so a key is never half recorded.
// `key-unknown` for a key that is not recordable, `name-taken` (REFUSE) for a
// name a sibling holds, `not-found` / `not-a-folder` for the folder.
// A picture or a PDF is recorded `PROCESSING` and a `renditions` job is added
// once the transaction commits (the worker makes `thumb` and `preview`, plan
// §3.14); any other type, or no queue, is `READY` at once. A job that cannot be
// added leaves the file `FAILED` for its previews: the original stays readable.
// The workspace counters rise in the same transaction (`core` is the core
// database, joined to it): a file that does not fit in the quota is
// `quotas.errors.exceeded`, nothing is recorded, and the object is deleted.
export async function addFile(
  mongo: FilesMongo,
  core: WorkspacesMongo,
  bucket: MediaBucket | undefined,
  renditions: RenditionsQueue | undefined,
  input: {
    workspaceId: string;
    accountId: string;
    key: string;
    name: string;
    parentId: string;
    onConflict: OnConflict;
  },
): Promise<NodeDoc> {
  const object = await storedObject(bucket, input.workspaceId, input.key);
  const rendered = renditions && renditionKindOf(object.mimeType) !== null;
  for (let attempt = 1; ; attempt++) {
    try {
      const node = await named(() =>
        mongo.transaction(async (tx) => {
          await lockTree(tx as unknown as NodesMongo, input.accountId);
          await recordBlob(tx, input.key, object);
          await addUsage(core.withSession(tx.session), input.workspaceId, {
            bytes: object.size,
            files: 1,
          });
          return insertFile(tx as unknown as NodesMongo, {
            parentId: input.parentId,
            accountId: input.accountId,
            name: input.name,
            onConflict: input.onConflict,
            blobKey: input.key,
            mimeType: object.mimeType,
            size: object.size,
            status: rendered ? "PROCESSING" : "READY",
          });
        }),
      );
      return rendered ? await enqueue(mongo, renditions, input, node) : node;
    } catch (error) {
      if (error instanceof KeyRecorded) throw keyUnknown();
      if (isQuotaExceeded(error)) {
        await discardObject(bucket, input.workspaceId, input.key);
        throw error;
      }
      // A concurrent writer took the name `KEEP_BOTH` had picked: pick again.
      if (
        input.onConflict === "KEEP_BOTH" &&
        attempt < ATTEMPTS &&
        isNameTaken(error)
      ) {
        continue;
      }
      throw error;
    }
  }
}

// Adds the node's `renditions` job. When Redis refuses it, the previews are
// given up: the node is `FAILED` (logged), never left `PROCESSING` for ever.
async function enqueue(
  mongo: FilesMongo,
  queue: RenditionsQueue,
  input: { workspaceId: string; key: string },
  node: NodeDoc,
): Promise<NodeDoc> {
  const job = { workspaceId: input.workspaceId, key: input.key };
  try {
    await queue.add(job, { id: renditionJobId(job) });
    return node;
  } catch (error) {
    console.error(
      `storix-api: could not queue the renditions of ${input.key} in workspace ${input.workspaceId}: ${error instanceof Error ? error.message : error}`,
    );
    await mongo.db.nodes.updateMany(
      { blobKey: input.key, status: "PROCESSING" },
      { status: "FAILED" },
      { audit: false },
    );
    return { ...node, status: "FAILED" };
  }
}

export const isQuotaExceeded = (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code ===
  "quotas.errors.exceeded";

const isNameTaken = (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code ===
  "nodes.errors.name-taken";

async function recordBlob(
  tx: FilesMongo,
  key: string,
  object: { size: number; mimeType: string },
) {
  if (await tx.db.blobs.findFirst({ key })) throw new KeyRecorded();
  try {
    await tx.db.blobs.create({ key, ...object, refs: 1 });
  } catch (error) {
    // Two recorders of one key at once: the unique index settles it.
    if (error instanceof ConflictError) throw new KeyRecorded();
    throw error;
  }
}

// Whether the account may read a `files` object: a live node of their own
// tree holds the key (sharing widens this one question later).
export async function mayRead(
  mongo: NodesMongo,
  read: { key: string; accountId: string },
): Promise<boolean> {
  const node = await mongo.db.nodes.findFirst({
    blobKey: read.key,
    ownerId: read.accountId,
    trashedAt: null,
  });
  return node !== undefined;
}
