import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { filesWorld } from "../../../../test/files.harness";
import { CROP_SIZES, cropsKeyOf, type RenditionsQueue } from "../rules";
import { requeueStuck } from "./index";
import { area as areaOf, later } from "./sweep.harness";

// The sweeps against the crops of a focal point: their keys are recorded on
// the blob (`blobs.crops`), not blobs of their own.
const added: { key: string; focalPoint?: unknown }[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    added.push(job as { key: string; focalPoint?: unknown });
    return {};
  },
};
const files = filesWorld({ renditions: queue });
const area = () => areaOf(files);
const POINT = { x: 0.2, y: 0.3 };

describe("the sweeps and the crops of a focal point", () => {
  test("the orphan pass keeps the objects of a recorded crops key", async () => {
    const a = await area();
    const up = await a.upload("kept");
    expect((await a.record(up.key, "kept.txt")).errors).toBeUndefined();
    const crops = cropsKeyOf(up.key, POINT);
    await a.stray(crops, [...CROP_SIZES]);
    await a.mongo.db.blobs.raw.updateOne(
      { key: up.key },
      { $addToSet: { crops } },
    );
    const report = await a.sweep({ now: later });
    expect(report).toMatchObject({ orphans: 0, failed: 0 });
    expect(await a.keys()).toHaveLength(1 + 1 + CROP_SIZES.length);
  });

  test("releasing a blob removes the objects of its crops keys", async () => {
    const a = await area();
    const key = await a.stray(undefined, ["thumb", "preview"]);
    const crops = cropsKeyOf(key, POINT);
    await a.stray(crops, [...CROP_SIZES]);
    await a.mongo.db.blobs.create({
      key,
      size: 1,
      mimeType: "text/plain",
      refs: 0,
      releasedAt: new Date(0),
      crops: [crops],
    });
    expect(await a.sweep()).toMatchObject({ released: 1, failed: 0 });
    expect(await a.keys()).toEqual([]);
  });

  test("two points of one blob give two jobs, each settled apart", async () => {
    const a = await area();
    const up = await a.upload("two");
    expect((await a.record(up.key, "a.png")).errors).toBeUndefined();
    const nodes = a.mongo.db.nodes.raw;
    const first = await nodes.findOne({ blobKey: up.key });
    await nodes.insertOne({
      ...first,
      _id: new ObjectId(),
      name: "b.png",
    } as never);
    await nodes.updateOne(
      { _id: first?._id as never },
      { $set: { focalPoint: { x: 0.1, y: 0.1 } } },
    );
    await nodes.updateOne(
      { name: "b.png", blobKey: up.key },
      { $set: { focalPoint: { x: 0.9, y: 0.9 } } },
    );
    await nodes.updateMany(
      { blobKey: up.key },
      {
        $set: {
          status: "READY",
          cropsStatus: "PROCESSING",
          renditionsAt: new Date(0),
        },
      },
    );
    added.length = 0;
    const report = await requeueStuck(a.mongo, queue, a.id, { now: later });
    expect(report).toEqual({ requeued: 2, failed: 0 });
    expect(added.map((job) => job.focalPoint)).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ]);
    // Each job counted its own point's nodes only.
    const counters = await nodes
      .find({ blobKey: up.key }, { projection: { renditionRequeues: 1 } })
      .toArray();
    expect(counters.map((node) => node["renditionRequeues"])).toEqual([1, 1]);
  });
});
