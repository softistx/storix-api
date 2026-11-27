import { type Duration, defineQueue } from "@softistx/redis";
import { z } from "zod";

// The queue of the renditions (plan §3.14): `addFile` adds one job per recorded
// upload of a type that has previews, the worker (`src/worker.ts`) makes the
// `thumb` and `preview` sizes and sets the node's status. A failed run is
// retried with a growing backoff; the handler marks the node `FAILED` when the
// last attempt is spent (src/modules/files/services/renditions.service.ts).

export const RENDITIONS_QUEUE = "renditions";

// What to render: the blob of one workspace, by its key. `crops` redoes only
// the four crops. `focalPoint` is the point the job was queued for (`null` is
// the centre): the crops are stored under that point's key, so two copies at
// different points never share them. A job without the field (queued before
// it existed) reads the point of the blob's first node.
export const renditionJob = z.object({
  workspaceId: z.string().min(1),
  key: z.string().min(1),
  crops: z.boolean().optional(),
  focalPoint: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable()
    .optional(),
});
export type RenditionJob = z.output<typeof renditionJob>;

export {
  buildRenditionJobId as renditionJobId,
  parseRenditionId as parseRenditionJobId,
} from "./renditions.id";

/** What a spec changes to wait milliseconds, not seconds. */
export type RenditionsQueueOptions = {
  attempts?: number;
  backoff?: { base: Duration; max: Duration };
};

export function defineRenditionsQueue(options: RenditionsQueueOptions = {}) {
  return defineQueue({
    name: RENDITIONS_QUEUE,
    schema: renditionJob,
    attempts: options.attempts ?? 4,
    backoff: options.backoff ?? { base: "10s", max: "10m" },
    // A page or a large picture decodes in seconds; two minutes is a stall.
    timeout: "2m",
    lease: "3m",
    keepCompleted: { age: "1h", count: 1_000 },
    keepFailed: "7d",
  });
}

export const renditions = defineRenditionsQueue();
