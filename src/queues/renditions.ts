import { type Duration, defineQueue } from "@softistx/redis";
import { z } from "zod";

// The queue of the renditions (plan §3.14): `addFile` adds one job per recorded
// upload of a type that has previews, the worker (`src/worker.ts`) makes the
// `thumb` and `preview` sizes and sets the node's status. A failed run is
// retried with a growing backoff; the handler marks the node `FAILED` when the
// last attempt is spent (src/modules/files/files.renditions.work.ts).

export const RENDITIONS_QUEUE = "renditions";

// What to render: the blob of one workspace, by its key.
export const renditionJob = z.object({
  workspaceId: z.string().min(1),
  key: z.string().min(1),
});
export type RenditionJob = z.output<typeof renditionJob>;

// The job's id: one job per recorded upload, however often it is added.
export const renditionJobId = (job: RenditionJob) =>
  `${job.workspaceId}:${job.key}`;

// The job a job id names (a workspace id has no colon).
export const parseRenditionJobId = (id: string): RenditionJob | null => {
  const at = id.indexOf(":");
  return at > 0 && at < id.length - 1
    ? { workspaceId: id.slice(0, at), key: id.slice(at + 1) }
    : null;
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
