import { renditionJobId } from "@/queues/renditions";
import type { FilesMongo } from "../models";
import { type Focal, type RenditionsQueue, sameFocal } from "../rules";

export interface RequeueStep {
  queue: RenditionsQueue;
  workspaceId: string;
  scope: "file" | "crops";
  field: "status" | "cropsStatus";
  now: Date;
  max: number;
  log: (message: string) => void;
}

// One blob at one focal point: queues its job again, or gives it up at the
// limit. The nodes at other points of the blob are left to their own turn.
export async function requeueOne(
  mongo: FilesMongo,
  step: RequeueStep,
  key: string,
  point: Focal | null,
  tries: number,
): Promise<"requeued" | "failed" | "skipped" | "down"> {
  const { queue, workspaceId, scope, field } = step;
  const nodes = mongo.db.nodes.raw;
  const where = {
    blobKey: key,
    [field]: "PROCESSING" as const,
    ...sameFocal(point),
  };
  if (tries >= step.max) {
    const done = await nodes.updateMany(where, { $set: { [field]: "FAILED" } });
    return done.modifiedCount > 0 ? "failed" : "skipped";
  }
  try {
    await queue.add(
      {
        workspaceId,
        key,
        focalPoint: point,
        ...(scope === "crops" && { crops: true }),
      },
      {
        id: renditionJobId(
          { workspaceId, key, focalPoint: point },
          // Unique per attempt: the counter is reset to 0 by a READY, a
          // focal move or a new version, and the queue keeps the first job
          // of an id it already holds (failed ones for 7 days).
          `stuck${tries + 1}-${crypto.randomUUID()}`,
        ),
      },
    );
  } catch (error) {
    step.log(
      `stuck renditions ${workspaceId}: ${key} not queued: ${error instanceof Error ? error.message : error}`,
    );
    return "down";
  }
  // On purpose a raw write, past the optimistic lock and the audit: the
  // sweep works at blob level, not on a node's versions.
  await nodes.updateMany(where, {
    $inc: { renditionRequeues: 1 },
    $set: { renditionsAt: step.now },
  });
  return "requeued";
}
