import { describe, expect, test } from "bun:test";
import type { MediaBucket } from "@softistx/alxia-media";
import { store } from "@/config/tenancy";
import { FOCAL, focalKit } from "../../../../test/files.focal.harness";
import { filesWorld } from "../../../../test/files.harness";
import { filesMongo } from "../models";
import { type RenditionsQueue, renditionsHandler } from "../public";

// A queue that holds its jobs: the spec calls the handler itself.
const queue: RenditionsQueue = { add: async () => ({}) };
const files = filesWorld({ renditions: queue });
const { area, crop } = focalKit(files);
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

const job = (workspaceId: string, key: string, crops: boolean) =>
  ({
    data: { workspaceId, key, ...(crops && { crops: true }) },
    attempt: 1,
    attempts: 3,
    signal: new AbortController().signal,
  }) as never;

// A bucket whose first store waits for `release`, after telling `reached`:
// the job is held past its read of the node, before it settles it.
function held() {
  let release = () => {};
  let reached = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const real = files.ctx.bucket;
  const bucket = {
    open: (input: Parameters<MediaBucket["open"]>[0]) => real.open(input),
    put: async (...args: Parameters<MediaBucket["put"]>) => {
      reached();
      await gate;
      return real.put(...args);
    },
  } as unknown as MediaBucket;
  return { bucket, release, arrived };
}

describe("a renditions job settles only the focal point it rendered", () => {
  test("a move during the first job is rendered again by that job before it settles", async () => {
    const a = await area();
    const file = await a.record("stale.png");
    const mongo = await databaseOf(a.workspace.id);
    const status = async () =>
      (await mongo.db.nodes.findFirst({ blobKey: file.key }))?.status;

    // The first full job reads the centre, then waits before storing.
    const gate = held();
    const first = renditionsHandler({
      bucket: gate.bucket,
      mongoOf: databaseOf,
    })(job(a.workspace.id, file.key, false));
    await gate.arrived;

    const moved = await a.send(FOCAL, {
      id: file.id,
      focalPoint: { x: 0.05, y: 0.5 },
    });
    expect(moved.errors).toBeUndefined();

    // The stale job ends: it sees the move after storing, redoes the crops
    // with the moved point and settles it.
    gate.release();
    await first;
    expect(await status()).toBe("READY");
    expect(await crop(a, file.key, "square")).toMatchObject({
      left: "red",
      right: "red",
    });
  });

  test("a job that rendered the current point settles it", async () => {
    const a = await area();
    const file = await a.record("fresh.png");
    const mongo = await databaseOf(a.workspace.id);
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.95, y: 0.5 } });
    await renditionsHandler({ bucket: files.ctx.bucket, mongoOf: databaseOf })(
      job(a.workspace.id, file.key, false),
    );
    const node = await mongo.db.nodes.findFirst({ blobKey: file.key });
    expect(node?.status).toBe("READY");
    expect(await crop(a, file.key, "square")).toMatchObject({
      left: "blue",
      right: "blue",
    });
  });

  test("a stale job that stores after the redo settled READY stores the moved crops again", async () => {
    const a = await area();
    const file = await a.record("late.png");
    const mongo = await databaseOf(a.workspace.id);
    const read = () => mongo.db.nodes.findFirst({ blobKey: file.key });

    // The stale full job read the centre and waits at its first store.
    const gate = held();
    const stale = renditionsHandler({
      bucket: gate.bucket,
      mongoOf: databaseOf,
    })(job(a.workspace.id, file.key, false));
    await gate.arrived;
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.05, y: 0.5 } });

    // The redo stores the moved crops and settles READY first.
    await renditionsHandler({ bucket: files.ctx.bucket, mongoOf: databaseOf })(
      job(a.workspace.id, file.key, true),
    );
    expect((await read())?.status).toBe("READY");

    // The stale job now overwrites them, then notices the move and redoes.
    gate.release();
    await stale;
    expect((await read())?.status).toBe("READY");
    expect(await crop(a, file.key, "square")).toMatchObject({
      left: "red",
      right: "red",
    });
  });
});
