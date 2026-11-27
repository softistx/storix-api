import type { RenditionJob } from "./renditions";

// A job id is `<workspaceId>:<key>[:<focal token>][:<redo token>]`; no part has
// a colon. The focal token names the point the job was queued for, so a failure
// of the job settles the nodes at that point only: `fpc` is the centre, and
// `fp<x>_<y>` a point in thousandths of the picture (`fp500_250` is 0.5, 0.25).
// An id with no focal token (queued before it existed) names no point.
const FOCAL_STEP = 1000;
const FOCAL_TOKEN = /^fp(?:(c)|(\d+)_(\d+))$/;

export const focalTokenOf = (focal: RenditionJob["focalPoint"]) =>
  focal
    ? `fp${Math.round(focal.x * FOCAL_STEP)}_${Math.round(focal.y * FOCAL_STEP)}`
    : "fpc";

const focalOfToken = (
  token: string,
): RenditionJob["focalPoint"] | undefined => {
  const match = FOCAL_TOKEN.exec(token);
  if (!match) return undefined;
  if (match[1]) return null;
  return {
    x: Number(match[2]) / FOCAL_STEP,
    y: Number(match[3]) / FOCAL_STEP,
  };
};

// The job's id: one job per recorded upload and point, however often it is
// added. A job that redoes the crops carries a `redo` token (each move of the
// focal point is its own job: the queue keeps finished ids for an hour).
export const buildRenditionJobId = (job: RenditionJob, redo?: string) =>
  [
    job.workspaceId,
    job.key,
    ...(job.focalPoint === undefined ? [] : [focalTokenOf(job.focalPoint)]),
    ...(redo ? [redo] : []),
  ].join(":");

// The blob and the point a job id names (`focalPoint` is left out for an id
// with no focal token).
export const parseRenditionId = (id: string): RenditionJob | null => {
  const [workspaceId, key, ...rest] = id.split(":");
  if (!workspaceId || !key) return null;
  const focal = rest.map(focalOfToken).find((point) => point !== undefined);
  return {
    workspaceId,
    key,
    ...(focal !== undefined && { focalPoint: focal }),
  };
};
