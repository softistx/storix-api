import { accountOf, type Who } from "@/core/members";
import { type NodeDoc, named, nodeFor } from "@/modules/nodes/public";
import { invalidFocal, notAFile, notRenderable } from "../files.errors";
import type { FilesMongo } from "../models";
import {
  type Focal,
  isFocal,
  type RenditionsQueue,
  renditionKindOf,
} from "../rules";
import { enqueue } from "./enqueue.service";

// Moves the focal point of a picture of the caller's tree (`null` is the
// centre) and has the worker redo its four crops from the stored original.
// `invalid-focal` for a coordinate outside 0 to 1, `not-a-file` for a folder,
// `not-renderable` for a file that is not a JPEG, PNG or WebP picture. The
// point is the tree's: every copy of the same owner and space takes it, a copy
// another member holds does not. With a
// queue a `READY` file stays `READY` and its `cropsStatus` is `PROCESSING`
// until the crops are stored (`READY`, or `FAILED` when only they failed);
// without one the point is recorded and the crops stay as they were. A file
// that is not `READY` (still `PROCESSING`, or `FAILED`) gets the full job
// (`status` `PROCESSING`), so its previews are made too. Answers the file as
// it is now and as it was.
export async function setFocalPoint(
  mongo: FilesMongo,
  renditions: RenditionsQueue | undefined,
  input: {
    id: string;
    accountId: Who;
    workspaceId: string;
    focalPoint: Focal | null;
  },
): Promise<{ node: NodeDoc; before: NodeDoc }> {
  if (input.focalPoint && !isFocal(input.focalPoint)) throw invalidFocal();
  const before = await nodeFor(mongo, input.id, input.accountId, "EDITOR");
  if (before.type !== "FILE" || !before.blobKey) throw notAFile();
  if (renditionKindOf(before.mimeType ?? "") !== "image") {
    throw notRenderable();
  }
  const cropsOnly = before.status === "READY";
  const change = {
    focalPoint: input.focalPoint && {
      x: input.focalPoint.x,
      y: input.focalPoint.y,
    },
    ...(renditions && {
      ...(cropsOnly
        ? { cropsStatus: "PROCESSING" as const }
        : { status: "PROCESSING" as const }),
      renditionRequeues: 0,
      renditionsAt: new Date(),
    }),
  };
  const node = await named(() =>
    mongo.db.nodes.as(accountOf(input.accountId)).update(before._id, change),
  );
  // The other nodes of the blob that sit in the same tree (copies the caller's
  // role reaches): silent, as the worker's statuses. A copy another member
  // holds is theirs: the caller has no role on it, so it keeps its point.
  await mongo.db.nodes.updateMany(
    {
      blobKey: before.blobKey,
      _id: { $ne: before._id },
      ownerId: before.ownerId,
      spaceId: before.spaceId,
    },
    change,
    { audit: false },
  );
  if (!renditions) return { node, before };
  const queued = await enqueue(
    mongo,
    renditions,
    {
      workspaceId: input.workspaceId,
      key: before.blobKey,
      ...(cropsOnly && { crops: true }),
    },
    node,
    crypto.randomUUID(),
  );
  return { node: queued, before };
}
