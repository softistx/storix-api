import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import type { RenditionJob } from "@/queues/renditions";
import { field } from "../../../../test/files.area";
import { FOCAL, picture } from "../../../../test/files.focal.harness";
import { COPY, filesWorld } from "../../../../test/files.harness";
import { ROOTS } from "../../../../test/nodes.harness";
import { sharesArea } from "../../../../test/shares.harness";
import { filesMongo } from "../models";
import { cropsKeyOf, type RenditionsQueue } from "../rules";
import { renditionsHandler } from "./renditions.service";

// A queue that keeps its jobs: the spec runs them through the handler.
const jobs: RenditionJob[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    jobs.push(job as RenditionJob);
    return {};
  },
};
const files = filesWorld({ renditions: queue });
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));
const KEY = `query($id: ID!) { node(id: $id) { ... on File { key cropsKey } } }`;

// A picture of the owner's shared folder and the editor's own copy of it: one
// blob, two owners.
async function twoOwners() {
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

const move = async (
  a: Awaited<ReturnType<typeof sharesArea>>,
  who: typeof a.users.owner,
  id: string,
  focalPoint: { x: number; y: number },
) => {
  const moved = await a.sendAs(who, FOCAL, { id, focalPoint });
  expect(moved.errors).toBeUndefined();
};

const keysOf = async (
  a: Awaited<ReturnType<typeof sharesArea>>,
  who: typeof a.users.owner,
  id: string,
) =>
  field<{ key: string; cropsKey: string }>(
    await a.sendAs(who, KEY, { id }),
    "node",
  );

async function drain(workspaceId: string) {
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

describe("copies of one blob at different focal points have their own crops", () => {
  test("two owners, two points: two crops keys, each rendered with its own point", async () => {
    const { a, original, copy } = await twoOwners();
    await drain(a.workspace.id);
    await move(a, a.users.owner, original.id, { x: 0.95, y: 0.5 });
    await move(a, a.users.editor, copy.id, { x: 0.05, y: 0.5 });
    expect(jobs.map((job) => job.focalPoint)).toEqual([
      { x: 0.95, y: 0.5 },
      { x: 0.05, y: 0.5 },
    ]);
    await drain(a.workspace.id);

    const mine = await keysOf(a, a.users.owner, original.id);
    const theirs = await keysOf(a, a.users.editor, copy.id);
    expect(mine.key).toBe(theirs.key);
    expect(mine.cropsKey).toBe(cropsKeyOf(mine.key, { x: 0.95, y: 0.5 }));
    expect(theirs.cropsKey).toBe(cropsKeyOf(mine.key, { x: 0.05, y: 0.5 }));
    expect(mine.cropsKey).not.toBe(theirs.cropsKey);

    const read = async (who: typeof a.users.owner, key: string) =>
      files.call(who, a.workspace.id, `/media/files/${key}/square`);
    const own = await read(a.users.owner, mine.cropsKey);
    const other = await read(a.users.editor, theirs.cropsKey);
    expect(own.status).toBe(200);
    expect(other.status).toBe(200);
    expect(own.headers.get("etag")).not.toBe(other.headers.get("etag"));

    const db = await databaseOf(a.workspace.id);
    const blob = await db.db.blobs.raw.findOne({ key: mine.key });
    expect([...(blob?.crops ?? [])].sort()).toEqual(
      [mine.cropsKey, theirs.cropsKey].sort(),
    );
  });

  test("copies at the same point share one crops key", async () => {
    const { a, original, copy } = await twoOwners();
    await drain(a.workspace.id);
    await move(a, a.users.owner, original.id, { x: 0.3, y: 0.6 });
    await move(a, a.users.editor, copy.id, { x: 0.3, y: 0.6 });
    await drain(a.workspace.id);
    const mine = await keysOf(a, a.users.owner, original.id);
    const theirs = await keysOf(a, a.users.editor, copy.id);
    expect(mine.cropsKey).toBe(theirs.cropsKey);
    const db = await databaseOf(a.workspace.id);
    const blob = await db.db.blobs.raw.findOne({ key: mine.key });
    expect(blob?.crops).toEqual([mine.cropsKey]);
  });

  test("the centre's crops key is the blob's own key", async () => {
    const { a, original } = await twoOwners();
    const keys = await keysOf(a, a.users.owner, original.id);
    expect(keys.cropsKey).toBe(keys.key);
  });
});
