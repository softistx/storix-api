import { type NodeDoc, named, ownedNode } from "@/modules/nodes/public";
import type { Focal } from "./files.crops";
import { enqueue } from "./files.enqueue";
import { invalidFocal, notAFile, notRenderable } from "./files.errors";
import type { FilesMongo } from "./files.handle";
import { type RenditionsQueue, renditionKindOf } from "./files.renditions";

// A coordinate is a number from 0 to 1 (fractions of the picture).
export const isFocal = (focal: Focal) =>
  [focal.x, focal.y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );

// Moves the focal point of a picture of the caller's tree (`null` is the
// centre) and has the worker redo its four crops from the stored original.
// `invalid-focal` for a coordinate outside 0 to 1, `not-a-file` for a folder,
// `not-renderable` for a file that is not a JPEG, PNG or WebP picture. The
// point is the blob's: every node that shares it (a copy) takes it. With a
// queue the file is `PROCESSING` until the crops are stored (`READY`, or
// `FAILED` when only they failed); without one the point is recorded and the
// crops stay as they were. A file that is not `READY` (still `PROCESSING`,
// or `FAILED`) gets the full job, so its previews are made too. Answers the file as it is now and as it was.
export async function setFocalPoint(
  mongo: FilesMongo,
  renditions: RenditionsQueue | undefined,
  input: {
    id: string;
    accountId: string;
    workspaceId: string;
    focalPoint: Focal | null;
  },
): Promise<{ node: NodeDoc; before: NodeDoc }> {
  if (input.focalPoint && !isFocal(input.focalPoint)) throw invalidFocal();
  const before = await ownedNode(mongo, input.id, input.accountId);
  if (before.type !== "FILE" || !before.blobKey) throw notAFile();
  if (renditionKindOf(before.mimeType ?? "") !== "image") {
    throw notRenderable();
  }
  const change = {
    focalPoint: input.focalPoint && {
      x: input.focalPoint.x,
      y: input.focalPoint.y,
    },
    ...(renditions && {
      status: "PROCESSING" as const,
      renditionRequeues: 0,
      renditionsAt: new Date(),
    }),
  };
  const node = await named(() =>
    mongo.db.nodes.as(input.accountId).update(before._id, change),
  );
  // The other nodes of the blob (copies): silent, as the worker's statuses.
  await mongo.db.nodes.updateMany(
    { blobKey: before.blobKey, _id: { $ne: before._id } },
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
      ...(before.status === "READY" && { crops: true }),
    },
    node,
    crypto.randomUUID(),
  );
  return { node: queued, before };
}
