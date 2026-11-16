import type { MediaBucket } from "@alxia/media";
import type { CollectionsOf, ModuleHandle } from "@alxia/modules";
import type { Mongo } from "@softistx/mongo";
import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  insertFile,
  lockTree,
  type NodeDoc,
  named,
  nodesMongo,
  type OnConflict,
  sameNameSibling,
} from "@/modules/nodes/public";
import { type RenditionJob, renditionJobId } from "@/queues/renditions";
import { KeyRecorded, recordBlob } from "./files.blob";
import { keyUnknown } from "./files.errors";
import { discardObject, storedObject } from "./files.object";
import { type RenditionsQueue, renditionKindOf } from "./files.renditions";
import { makeFirstVersion } from "./files.versions.first";
import { pushVersion } from "./files.versions.push";

// The module's handle on a workspace's database: its own collection, and the
// nodes it records files in.
export type FilesMongo = ModuleHandle<
  "files",
  Mongo<{ collections: CollectionsOf }>
>;

// Tries `KEEP_BOTH` again when a writer took the free name first.
const ATTEMPTS = 3;

// What `addFile` answers: the file, and the number of the version it made
// when the upload went into an existing file (`NEW_VERSION`), else null.
export interface Added {
  node: NodeDoc;
  appended: number | null;
}

// What `addFile` is given; `NEW_VERSION` is the one conflict rule of the
// files module (the nodes module knows `REFUSE` and `KEEP_BOTH`).
export interface AddInput {
  workspaceId: string;
  accountId: string;
  key: string;
  name: string;
  parentId: string;
  onConflict: OnConflict | "NEW_VERSION";
}

// Records an uploaded object as a file under a folder of the caller's tree
// (plan §3.5): the object must lie under this workspace's `files` prefix and
// no blob may hold its key yet; its type and size are the storage's. The blob
// and the node are one transaction, so a key is never half recorded.
// `key-unknown` for a key that is not recordable, `name-taken` (REFUSE) for a
// name a sibling holds, `not-found` / `not-a-folder` for the folder.
// `NEW_VERSION` puts the upload into the file of that name as a new current
// version (a folder of that name is `name-taken`; no file of that name makes a
// new file). A new file is recorded with its version 1.
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
  input: AddInput,
): Promise<Added> {
  const object = await storedObject(bucket, input.workspaceId, input.key);
  const rendered = renditions && renditionKindOf(object.mimeType) !== null;
  for (let attempt = 1; ; attempt++) {
    try {
      const done = await named(() =>
        mongo.transaction((tx) =>
          record(tx, core, input, object, rendered ? "PROCESSING" : "READY"),
        ),
      );
      const node = rendered
        ? await enqueue(
            mongo,
            renditions,
            { workspaceId: input.workspaceId, key: input.key },
            done.node,
          )
        : done.node;
      return { ...done, node };
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

// The transaction of `addFile`: the tree lock first, then a new file with its
// version 1, or the new version of the file the name already holds.
async function record(
  tx: FilesMongo,
  core: WorkspacesMongo,
  input: AddInput,
  object: { size: number; mimeType: string },
  status: "READY" | "PROCESSING",
): Promise<Added> {
  await lockTree(nodesMongo(tx), input.accountId);
  if (input.onConflict === "NEW_VERSION") {
    const same = await sameNameSibling(nodesMongo(tx), input);
    if (same?.type === "FILE") {
      const { node, number } = await pushVersion(tx, core, same, {
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        blob: { key: input.key, ...object },
        fresh: true,
        status,
        note: null,
        restoredFrom: null,
      });
      return { node, appended: number };
    }
  }
  await recordBlob(tx, input.key, object, 2);
  await addUsage(core.withSession(tx.session), input.workspaceId, {
    bytes: object.size,
    files: 1,
  });
  const file = await insertFile(nodesMongo(tx), {
    parentId: input.parentId,
    accountId: input.accountId,
    name: input.name,
    onConflict: input.onConflict === "KEEP_BOTH" ? "KEEP_BOTH" : "REFUSE",
    blobKey: input.key,
    mimeType: object.mimeType,
    size: object.size,
    status,
  });
  return {
    node: await makeFirstVersion(tx, file, input.accountId),
    appended: null,
  };
}

// Adds the node's `renditions` job (`redo` names a repeat of the same blob's
// job, see `renditionJobId`). When Redis refuses it, the previews are given
// up: the node is `FAILED` (logged), never left `PROCESSING` for ever.
export async function enqueue(
  mongo: FilesMongo,
  queue: RenditionsQueue,
  job: RenditionJob,
  node: NodeDoc,
  redo?: string,
): Promise<NodeDoc> {
  try {
    await queue.add(job, { id: renditionJobId(job, redo) });
    return node;
  } catch (error) {
    console.error(
      `storix-api: could not queue the renditions of ${job.key} in workspace ${job.workspaceId}: ${error instanceof Error ? error.message : error}`,
    );
    // The file is recorded either way: a second failure is logged, not thrown.
    await mongo.db.nodes
      .updateMany(
        { blobKey: job.key, status: "PROCESSING" },
        { status: "FAILED" },
        { audit: false },
      )
      .catch((cause) =>
        console.error(`storix-api: could not mark ${job.key} FAILED: ${cause}`),
      );
    return { ...node, status: "FAILED" };
  }
}

// Whether `error` is a GraphQL error carrying the catalogue code.
const hasCode = (code: string) => (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code === code;

export const isQuotaExceeded = hasCode("quotas.errors.exceeded");

const isNameTaken = hasCode("nodes.errors.name-taken");

// Whether the account may read a `files` object: a live node of their own
// tree holds the key, as its blob or as one of its versions' (sharing widens
// this one question later).
export async function mayRead(
  mongo: FilesMongo,
  read: { key: string; accountId: string },
): Promise<boolean> {
  const own = { ownerId: read.accountId, trashedAt: null };
  if (await mongo.db.nodes.findFirst({ blobKey: read.key, ...own })) {
    return true;
  }
  const fileIds = await mongo.db.versions.raw.distinct("fileId", {
    blobKey: read.key,
  });
  if (fileIds.length === 0) return false;
  const node = await mongo.db.nodes.findFirst({
    _id: { $in: fileIds },
    ...own,
  });
  return node !== undefined;
}
