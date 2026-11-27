import { describe, expect, test } from "bun:test";
import type { MediaBucket } from "@softistx/alxia-media";
import { store } from "@/config/tenancy";
import { FOCAL, focalKit } from "../../../../test/files.focal.harness";
import { filesWorld } from "../../../../test/files.harness";
import { filesMongo } from "../models";
import { type RenditionsQueue, renditionsHandler } from "../public";
import { requeueStuck } from "./index";

// A queue that holds its jobs: the spec calls the handler itself.
const jobs: {
  workspaceId: string;
  key: string;
  crops?: boolean | undefined;
}[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    jobs.push(job);
    return {};
  },
};
const files = filesWorld({ renditions: queue });
const { area } = focalKit(files);
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

const job = (workspaceId: string, key: string, crops: boolean) =>
  ({
    data: { workspaceId, key, ...(crops && { crops: true }) },
    attempt: 3,
    attempts: 3,
    signal: new AbortController().signal,
  }) as never;

// A READY picture whose focal point was just moved: its crops are pending.
async function movedFile(name: string) {
  const a = await area();
  const file = await a.record(name);
  const mongo = await databaseOf(a.workspace.id);
  const handler = renditionsHandler({
    bucket: files.ctx.bucket,
    mongoOf: databaseOf,
  });
  await handler(job(a.workspace.id, file.key, false));
  const moved = await a.send(FOCAL, {
    id: file.id,
    focalPoint: { x: 0.05, y: 0.5 },
  });
  expect(moved.errors).toBeUndefined();
  const node = () => mongo.db.nodes.findFirst({ blobKey: file.key });
  return { a, file, mongo, handler, node };
}

describe("a crops job settles cropsStatus and leaves status alone", () => {
  test("the move keeps the file READY and the crops PROCESSING until the job ends", async () => {
    const { a, file, handler, node } = await movedFile("pending.png");
    expect(await node()).toMatchObject({
      status: "READY",
      cropsStatus: "PROCESSING",
    });
    await handler(job(a.workspace.id, file.key, true));
    expect(await node()).toMatchObject({
      status: "READY",
      cropsStatus: "READY",
    });
  });

  test("a crops job that fails marks only the crops FAILED", async () => {
    const { a, file, node } = await movedFile("broken.png");
    const real = files.ctx.bucket;
    const bucket = {
      open: (input: Parameters<MediaBucket["open"]>[0]) => real.open(input),
      put: async () => {
        throw new Error("storage is down");
      },
    } as unknown as MediaBucket;
    try {
      await renditionsHandler({ bucket, mongoOf: databaseOf })(
        job(a.workspace.id, file.key, true),
      );
    } catch {
      // The job gave up on its last attempt.
    }
    expect(await node()).toMatchObject({
      status: "READY",
      cropsStatus: "FAILED",
    });
  });

  test("the stuck sweep queues a crops job again, then gives the crops up", async () => {
    const { a, file, mongo, node } = await movedFile("stuck.png");
    await mongo.db.nodes.raw.updateMany(
      { blobKey: file.key },
      { $set: { renditionsAt: new Date(Date.now() - 2 * 60 * 60_000) } },
    );
    jobs.length = 0;
    const first = await requeueStuck(mongo, queue, a.workspace.id);
    expect(first).toMatchObject({ requeued: 1, failed: 0 });
    expect(jobs).toEqual([
      { workspaceId: a.workspace.id, key: file.key, crops: true },
    ]);
    expect(await node()).toMatchObject({ status: "READY" });

    await mongo.db.nodes.raw.updateMany(
      { blobKey: file.key },
      {
        $set: {
          renditionRequeues: 3,
          renditionsAt: new Date(Date.now() - 2 * 60 * 60_000),
        },
      },
    );
    const last = await requeueStuck(mongo, queue, a.workspace.id);
    expect(last).toMatchObject({ requeued: 0, failed: 1 });
    expect(await node()).toMatchObject({
      status: "READY",
      cropsStatus: "FAILED",
    });
  });
});
