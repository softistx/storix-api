import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { renditionJobId } from "@/queues/renditions";
import { filesWorld } from "../../../../test/files.harness";
import { markRenditionsFailed } from "./renditions.service";
import { area as areaOf } from "./sweep.harness";

// The worker's `failed` event gives up the nodes of the failing point only: a
// node at another point is waiting for its own job (or the stuck sweep).
const files = filesWorld({ renditions: { add: async () => ({}) } });
const A = { x: 0.1, y: 0.1 };
const B = { x: 0.9, y: 0.9 };

async function twoPoints() {
  const a = await areaOf(files);
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
    { name: "a.png", blobKey: up.key },
    { $set: { focalPoint: A } },
  );
  await nodes.updateOne(
    { name: "b.png", blobKey: up.key },
    { $set: { focalPoint: B } },
  );
  const set = (fields: object) =>
    nodes.updateMany({ blobKey: up.key }, { $set: fields });
  const states = async (field: "status" | "cropsStatus") =>
    Object.fromEntries(
      (await nodes.find({ blobKey: up.key }).toArray()).map((n) => [
        n["name"],
        n[field],
      ]),
    );
  const fail = (id: string) =>
    markRenditionsFailed({ mongoOf: async () => a.mongo }, id);
  return { a, key: up.key, set, states, fail };
}

describe("a failed renditions job and focal points", () => {
  test("crops: the failing point's nodes go FAILED, the other stays", async () => {
    const t = await twoPoints();
    await t.set({ status: "READY", cropsStatus: "PROCESSING" });
    await t.fail(
      renditionJobId(
        { workspaceId: t.a.id, key: t.key, focalPoint: A },
        "stuck1-x",
      ),
    );
    expect(await t.states("cropsStatus")).toEqual({
      "a.png": "FAILED",
      "b.png": "PROCESSING",
    });
    expect(await t.states("status")).toEqual({
      "a.png": "READY",
      "b.png": "READY",
    });
  });

  test("previews stay per blob: every PROCESSING node goes FAILED", async () => {
    const t = await twoPoints();
    await t.set({ status: "PROCESSING", cropsStatus: null });
    await t.fail(
      renditionJobId({ workspaceId: t.a.id, key: t.key, focalPoint: A }),
    );
    expect(await t.states("status")).toEqual({
      "a.png": "FAILED",
      "b.png": "FAILED",
    });
  });

  test("a legacy id with no token gives up the whole blob as before", async () => {
    const t = await twoPoints();
    await t.set({ status: "READY", cropsStatus: "PROCESSING" });
    await t.fail(`${t.a.id}:${t.key}`);
    expect(await t.states("cropsStatus")).toEqual({
      "a.png": "FAILED",
      "b.png": "FAILED",
    });
  });
});
