import type { NodeDoc } from "@/modules/nodes/public";
import { type RenditionJob, renditionJobId } from "@/queues/renditions";
import type { RenditionsQueue } from "../files.renditions";
import type { FilesMongo } from "../models";

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
