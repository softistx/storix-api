import { expect } from "bun:test";
import { store } from "@/config/tenancy";
import type { RenditionJob } from "@/queues/renditions";
import { field } from "../../../../test/files.area";
import { FOCAL, picture } from "../../../../test/files.focal.harness";
import { COPY, filesWorld } from "../../../../test/files.harness";
import { ROOTS } from "../../../../test/nodes.harness";
import { sharesArea } from "../../../../test/shares.harness";
import { filesMongo } from "../models";
import type { RenditionsQueue } from "../rules";
import { renditionsHandler } from "./renditions.service";

// A queue that keeps its jobs: the spec runs them through the handler.
export const jobs: RenditionJob[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    jobs.push(job as RenditionJob);
    return {};
  },
};
export const files = filesWorld({ renditions: queue });
export const databaseOf = async (id: string) =>
  filesMongo(await store.databaseOf(id));
const KEY = `query($id: ID!) { node(id: $id) { ... on File { key cropsKey } } }`;

// A picture of the owner's shared folder and the editor's own copy of it: one
// blob, two owners.
export async function twoOwners() {
  const a = await sharesArea(files);
  const original = await files.addFile(
    a.users.owner,
    a.workspace.id,
    a.folder.id,
    "p.png",
    picture(2000, 1000),
    "image/png",
  );
  const roots = await a.sendAs(a.users.editor, ROOTS);
  const [root] = field<{ id: string }[]>(roots, "roots");
  const copied = await a.sendAs(a.users.editor, COPY, {
    ids: [original.id],
    parentId: root?.id,
  });
  expect(copied.errors).toBeUndefined();
  const [copy] = field<{ id: string }[]>(copied, "copyNodes");
  return { a, original, copy: copy as { id: string } };
}

export const move = async (
  a: Awaited<ReturnType<typeof sharesArea>>,
  who: typeof a.users.owner,
  id: string,
  focalPoint: { x: number; y: number },
) => {
  const moved = await a.sendAs(who, FOCAL, { id, focalPoint });
  expect(moved.errors).toBeUndefined();
};

export const keysOf = async (
  a: Awaited<ReturnType<typeof sharesArea>>,
  who: typeof a.users.owner,
  id: string,
) =>
  field<{ key: string; cropsKey: string }>(
    await a.sendAs(who, KEY, { id }),
    "node",
  );

export async function drain(workspaceId: string) {
  const handler = renditionsHandler({
    bucket: files.ctx.bucket,
    mongoOf: databaseOf,
  });
  for (const data of jobs.splice(0)) {
    await handler({
      data,
      attempt: 1,
      attempts: 3,
      signal: new AbortController().signal,
    } as never);
  }
  expect(workspaceId).toBeTruthy();
}

// Runs one job through the handler, on the real bucket or one that fails.
export const run = (
  job: RenditionJob | undefined,
  options: { broken?: boolean; attempt?: number } = {},
) =>
  renditionsHandler({
    bucket: options.broken
      ? ({
          ...files.ctx.bucket,
          open: () => Promise.reject(new Error("down")),
        } as never)
      : files.ctx.bucket,
    mongoOf: databaseOf,
  })({
    data: job,
    attempt: options.attempt ?? 1,
    attempts: 3,
    signal: new AbortController().signal,
  } as never);
