import { type Duration, defineQueue } from "@softistx/redis";
import { z } from "zod";

// The queue of the renditions (plan §3.14): `addFile` adds one job per recorded
// upload of a type that has previews, the worker (`src/worker.ts`) makes the
// `thumb` and `preview` sizes and sets the node's status. A failed run is
// retried with a growing backoff; the handler marks the node `FAILED` when the
// last attempt is spent (src/modules/files/files.renditions.work.ts).

export const RENDITIONS_QUEUE = "renditions";

// What to render: the blob of one workspace, by its key. `crops` redoes only
// the four crops, from the focal point the node holds when the job runs (a move
// of the point).
export const renditionJob = z.object({
  workspaceId: z.string().min(1),
  key: z.string().min(1),
  crops: z.boolean().optional(),
});
export type RenditionJob = z.output<typeof renditionJob>;

// The job's id: one job per recorded upload, however often it is added. A job
// that redoes the crops carries a `redo` token (each move of the focal point
// is its own job: the queue keeps finished ids for an hour).
export const renditionJobId = (job: RenditionJob, redo?: string) =>
  `${job.workspaceId}:${job.key}${redo ? `:${redo}` : ""}`;

// The blob a job id names (a workspace id, a media key and a token have no
// colon).
export const parseRenditionJobId = (id: string): RenditionJob | null => {
  const [workspaceId, key] = id.split(":");
  return workspaceId && key ? { workspaceId, key } : null;
};

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
