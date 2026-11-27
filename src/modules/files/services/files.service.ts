import type { MediaBucket } from "@softistx/alxia-media";
import { accountOf, type Who } from "@/core/members";
import { addUsage, type WorkspacesMongo } from "@/core/workspaces";
import {
  insertFile,
  lockTreesOf,
  type NodeDoc,
  named,
  nodesMongo,
  type OnConflict,
  sameNameSibling,
} from "@/modules/nodes/public";
import { keyUnknown } from "../files.errors";
import type { FilesMongo } from "../models";
import { type RenditionsQueue, renditionKindOf } from "../rules";
import {
  discardObject,
  isNameTaken,
  isQuotaExceeded,
  storedObject,
} from "../utils";
import { KeyRecorded, recordBlob } from "./blob.service";
import { enqueue } from "./enqueue.service";
import { makeFirstVersion, pushVersion } from "./versions.service";

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
  accountId: Who;
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
            {
              workspaceId: input.workspaceId,
              key: input.key,
              focalPoint: null,
            },
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
  await lockTreesOf(nodesMongo(tx), [input.parentId]);
  if (input.onConflict === "NEW_VERSION") {
    const same = await sameNameSibling(nodesMongo(tx), input);
    if (same?.type === "FILE") {
      const { node, number } = await pushVersion(tx, core, same, {
        workspaceId: input.workspaceId,
        accountId: accountOf(input.accountId),
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
    node: await makeFirstVersion(tx, file, accountOf(input.accountId)),
    appended: null,
  };
}
