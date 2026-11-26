import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { field } from "../../../../test/files.area";
import {
  ADD,
  type FileView,
  filesWorld,
  png,
} from "../../../../test/files.harness";
import { setup } from "../../nodes/nodes.harness";
import { filesMongo } from "../models";
import type { RenditionsQueue } from "../rules";
import type { SweepBucket } from "../utils";
import { SWEEP_LOCK_MS, sweepWorkspace } from "./index";

// The sweep's lock: one sweep per workspace at a time, so two runs started
// together never both act, and a stuck file is queued again once.
const added: string[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    added.push(job.key);
    return {};
  },
};
const files = filesWorld({ renditions: queue });

async function stuck() {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(
    workspace.owner,
    workspace.id,
    png(64),
    "image/png",
  );
  const sent = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name: "s.png", parentId: root.id } },
  });
  expect(sent.errors).toBeUndefined();
  field<FileView>(sent, "addFile");
  const mongo = filesMongo(await store.databaseOf(workspace.id));
  await mongo.db.nodes.raw.updateMany(
    { blobKey: up.key },
    { $set: { renditionsAt: new Date(0) } },
  );
  const requeues = async () =>
    (await mongo.db.nodes.raw.findOne({ blobKey: up.key }))?.[
      "renditionRequeues"
    ];
  const sweep = (over = {}, bucket = files.ctx.bucket as SweepBucket) =>
    sweepWorkspace(mongo, bucket, workspace.id, {
      log: () => {},
      renditions: queue,
      ...over,
    });
  return { mongo, key: up.key, requeues, sweep };
}

describe("the sweep lock", () => {
  test("two sweeps started together: one acts, the other skips, the requeue counts once", async () => {
    const a = await stuck();
    added.length = 0;
    const reports = await Promise.all([a.sweep(), a.sweep()]);
    expect(reports.filter((r) => r.skipped === true)).toHaveLength(1);
    expect(reports.filter((r) => r.stuck?.requeued === 1)).toHaveLength(1);
    expect(added.filter((key) => key === a.key)).toHaveLength(1);
    expect(await a.requeues()).toBe(1);
  });

  test("the lock is given back when the sweep ends, so the next run acts", async () => {
    const a = await stuck();
    expect((await a.sweep()).skipped).toBeUndefined();
    expect(await a.mongo.db.sweepLocks.raw.countDocuments({})).toBe(0);
    const next = await a.sweep();
    expect(next.skipped).toBeUndefined();
  });

  test("a sweep that throws gives the lock back", async () => {
    const a = await stuck();
    const broken: SweepBucket = {
      list: async () => {
        throw new Error("bucket down");
      },
      delete: async () => {},
    };
    await expect(a.sweep({}, broken)).rejects.toThrow("bucket down");
    expect(await a.mongo.db.sweepLocks.raw.countDocuments({})).toBe(0);
  });

  test("a lock still held skips the run and changes nothing", async () => {
    const a = await stuck();
    const now = new Date();
    await a.mongo.db.sweepLocks.raw.insertOne({
      _id: "sweep",
      heldBy: "someone",
      until: new Date(now.getTime() + SWEEP_LOCK_MS),
    });
    added.length = 0;
    const report = await a.sweep({ now: () => now });
    expect(report).toEqual({
      released: 0,
      orphans: 0,
      failed: 0,
      skipped: true,
    });
    expect(added).toEqual([]);
    expect(await a.requeues()).toBe(0);
  });

  test("an expired lock is taken over", async () => {
    const a = await stuck();
    const now = new Date();
    await a.mongo.db.sweepLocks.raw.insertOne({
      _id: "sweep",
      heldBy: "a crashed sweep",
      until: new Date(now.getTime() - 1),
    });
    const report = await a.sweep({ now: () => now });
    expect(report.skipped).toBeUndefined();
    expect(report.stuck?.requeued).toBe(1);
    expect(await a.mongo.db.sweepLocks.raw.countDocuments({})).toBe(0);
  });
});
