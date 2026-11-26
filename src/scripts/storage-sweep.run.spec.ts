import { describe, expect, spyOn, test } from "bun:test";
import { store, tenancy } from "@/config/tenancy";
import { field } from "../../test/files.area";
import { ADD, type FileView, filesWorld, png } from "../../test/files.harness";
import { workspacesMongo } from "../core/workspaces";
import { filesMongo, type RenditionsQueue } from "../modules/files/public";
import { setup } from "../modules/nodes/nodes.harness";
import { runStorageSweep } from "./storage-sweep.run";

// Jobs are collected; `refuse` makes the queue throw.
let refuse = false;
const added: string[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    if (refuse) throw new Error("redis is down");
    added.push(job.key);
    return {};
  },
};
const files = filesWorld({ renditions: queue });

async function stuckKey() {
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
  return up.key;
}

const run = (renditions?: RenditionsQueue) =>
  runStorageSweep(
    workspacesMongo(tenancy.core),
    (id) => store.databaseOf(id),
    files.ctx.bucket,
    renditions,
  );

describe("the storage sweep script", () => {
  test("hands the stuck files to the queue when Redis is configured", async () => {
    const key = await stuckKey();
    added.length = 0;
    const out = await run(queue);
    expect(added).toContain(key);
    expect(out.summary).toMatch(/[1-9]\d* stuck files queued again/);
  });

  test("without Redis it queues nothing", async () => {
    await stuckKey();
    added.length = 0;
    const out = await run();
    expect(added).toEqual([]);
    expect(out.summary).toContain("0 stuck files queued again");
  });

  test("a queue that refuses leaves nodesLeft and exits 1", async () => {
    await stuckKey();
    refuse = true;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await run(queue);
      expect(out.exitCode).toBe(1);
      expect(out.summary).toMatch(/[1-9]\d* stuck files left/);
    } finally {
      refuse = false;
      warn.mockRestore();
    }
  });

  test("a workspace another sweep holds is skipped, and that is not a failure", async () => {
    await stuckKey();
    const first = await run(queue);
    expect(first.summary).toContain("0 workspaces skipped");
    const { workspace } = await setup(files.ctx.w);
    const mongo = filesMongo(await store.databaseOf(workspace.id));
    await mongo.db.sweepLocks.raw.insertOne({
      _id: "sweep",
      heldBy: "another run",
      until: new Date(Date.now() + 60_000),
    });
    const out = await run(queue);
    expect(out.summary).toMatch(/[1-9]\d* workspaces skipped/);
    expect(out.exitCode).toBe(0);
  });
});
