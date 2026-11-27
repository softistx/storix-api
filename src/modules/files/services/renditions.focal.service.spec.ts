import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { FOCAL, focalKit } from "../../../../test/files.focal.harness";
import { filesWorld } from "../../../../test/files.harness";
import { filesMongo } from "../models";
import { cropsKeyOf, type RenditionsQueue } from "../rules";
import { renditionsHandler } from "./renditions.service";

// A queue that holds its jobs: the spec calls the handler itself.
const queue: RenditionsQueue = { add: async () => ({}) };
const files = filesWorld({ renditions: queue });
const { area, crop } = focalKit(files);
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

const run = (data: Record<string, unknown>) =>
  renditionsHandler({ bucket: files.ctx.bucket, mongoOf: databaseOf })({
    data,
    attempt: 1,
    attempts: 3,
    signal: new AbortController().signal,
  } as never);

describe("a renditions job renders the point it was queued for", () => {
  test("the crops of a point are stored under that point's key and settle its node", async () => {
    const a = await area();
    const file = await a.record("fresh.png");
    const mongo = await databaseOf(a.workspace.id);
    const focal = { x: 0.95, y: 0.5 };
    await a.send(FOCAL, { id: file.id, focalPoint: focal });
    await run({
      workspaceId: a.workspace.id,
      key: file.key,
      focalPoint: focal,
    });
    const node = await mongo.db.nodes.findFirst({ blobKey: file.key });
    expect(node?.status).toBe("READY");
    const cropsKey = cropsKeyOf(file.key, focal);
    expect(cropsKey).not.toBe(file.key);
    expect(await crop(a, cropsKey, "square")).toMatchObject({
      left: "blue",
      right: "blue",
    });
    // The centre's crops are not made by this job; the previews are the blob's.
    const centre = await files.call(
      a.workspace.owner,
      a.workspace.id,
      `/media/files/${file.key}/square`,
    );
    expect(centre.status).toBe(404);
    expect(await crop(a, file.key, "thumb")).toMatchObject({
      type: "image/webp",
    });
    const blob = await mongo.db.blobs.raw.findOne({ key: file.key });
    expect(blob?.crops).toEqual([cropsKey]);
  });

  test("a job for the centre leaves a node that moved meanwhile processing", async () => {
    const a = await area();
    const file = await a.record("stale.png");
    const mongo = await databaseOf(a.workspace.id);
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.05, y: 0.5 } });
    await run({ workspaceId: a.workspace.id, key: file.key, focalPoint: null });
    const node = await mongo.db.nodes.findFirst({ blobKey: file.key });
    expect(node?.status).toBe("PROCESSING");
    // Its own job then settles it, without touching the centre's crops.
    await run({
      workspaceId: a.workspace.id,
      key: file.key,
      focalPoint: { x: 0.05, y: 0.5 },
    });
    expect(
      (await mongo.db.nodes.findFirst({ blobKey: file.key }))?.status,
    ).toBe("READY");
    expect(await crop(a, file.key, "square")).toMatchObject({
      left: "red",
      right: "blue",
    });
    expect(
      await crop(a, cropsKeyOf(file.key, { x: 0.05, y: 0.5 }), "square"),
    ).toMatchObject({ left: "red", right: "red" });
  });

  test("a job queued before the field reads the node's point", async () => {
    const a = await area();
    const file = await a.record("legacy.png");
    const focal = { x: 0.95, y: 0.5 };
    await a.send(FOCAL, { id: file.id, focalPoint: focal });
    await run({ workspaceId: a.workspace.id, key: file.key });
    expect(await crop(a, cropsKeyOf(file.key, focal), "square")).toMatchObject({
      left: "blue",
    });
  });
});
