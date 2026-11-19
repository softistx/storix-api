import { describe, expect, spyOn, test } from "bun:test";
import { store } from "@/config/tenancy";
import { field } from "../../../test/files.area";
import {
  ADD,
  type FileView,
  filesWorld,
  png,
} from "../../../test/files.harness";
import { setup } from "../nodes/nodes.harness";
import { filesMongo } from "./files.handle";
import type { RenditionsQueue } from "./files.renditions";
import { sweepWorkspace } from "./files.sweep";
import { requeueStuck } from "./files.sweep.stuck";

// Jobs are collected, never run; `refuse` makes the queue throw.
let refuse = false;
// Jobs accepted before the queue starts to refuse (null: no such limit).
let acceptOnly: number | null = null;
let accepted = 0;
const added: { key: string; id: string | undefined }[] = [];
const queue: RenditionsQueue = {
  add: async (job, options) => {
    if (refuse || (acceptOnly !== null && accepted >= acceptOnly))
      throw new Error("redis is down");
    accepted += 1;
    added.push({ key: job.key, id: options?.id });
    return {};
  },
};
const files = filesWorld({ renditions: queue });

async function stuckFile() {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(
    workspace.owner,
    workspace.id,
    png(64),
    "image/png",
  );
  const result = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name: "a.png", parentId: root.id } },
  });
  expect(result.errors).toBeUndefined();
  field<FileView>(result, "addFile");
  const mongo = filesMongo(await store.databaseOf(workspace.id));
  const node = () => mongo.db.nodes.findFirst({ blobKey: up.key });
  const second = async () => {
    const more = await files.upload(
      workspace.owner,
      workspace.id,
      png(65),
      "image/png",
    );
    const sent = await files.ctx.w.send(workspace.owner, ADD, {
      ...at,
      variables: { input: { key: more.key, name: "b.png", parentId: root.id } },
    });
    expect(sent.errors).toBeUndefined();
    return more.key;
  };
  return { mongo, key: up.key, workspaceId: workspace.id, node, second };
}

// Two stuck files of one workspace: `first` is the older.
async function twoStuck() {
  const a = await stuckFile();
  const secondKey = await a.second();
  await a.mongo.db.nodes.raw.updateMany(
    { blobKey: a.key },
    { $set: { renditionsAt: new Date(0) } },
  );
  await a.mongo.db.nodes.raw.updateMany(
    { blobKey: secondKey },
    { $set: { renditionsAt: new Date(1000) } },
  );
  const status = (key: string) =>
    a.mongo.db.nodes
      .findFirst({ blobKey: key })
      .then((n) => n?.renditionRequeues);
  return { ...a, secondKey, status };
}

describe("files stuck PROCESSING", () => {
  test("a recent file is left alone", async () => {
    const a = await stuckFile();
    const report = await requeueStuck(a.mongo, queue, a.workspaceId);
    expect(report).toEqual({ requeued: 0, failed: 0 });
    expect((await a.node())?.status).toBe("PROCESSING");
  });

  test("an old one is queued again, then FAILED past the retry limit", async () => {
    const a = await stuckFile();
    added.length = 0;
    const later = new Date(Date.now() + 2 * 3_600_000);
    const run = () =>
      requeueStuck(a.mongo, queue, a.workspaceId, {
        now: () => later,
        maxRequeues: 2,
      });
    // Each run happens "later": push the node's date back so it is old again.
    const age = () =>
      a.mongo.db.nodes.raw.updateMany(
        { blobKey: a.key },
        { $set: { renditionsAt: new Date(0) } },
      );
    await age();
    expect(await run()).toEqual({ requeued: 1, failed: 0 });
    await age();
    expect(await run()).toEqual({ requeued: 1, failed: 0 });
    expect(added.map((job) => job.id?.split(":").at(-1))).toEqual([
      "stuck1",
      "stuck2",
    ]);
    await age();
    expect(await run()).toEqual({ requeued: 0, failed: 1 });
    expect((await a.node())?.status).toBe("FAILED");
  });

  test("a queue that refuses stops the scan and leaves the file for the next run", async () => {
    const a = await stuckFile();
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.key },
      { $set: { renditionsAt: new Date(0) } },
    );
    refuse = true;
    try {
      const report = await requeueStuck(a.mongo, queue, a.workspaceId, {
        log: () => {},
      });
      expect(report).toEqual({ requeued: 0, failed: 0, nodesLeft: 1 });
    } finally {
      refuse = false;
    }
    const node = await a.node();
    expect(node?.status).toBe("PROCESSING");
    expect(node?.renditionRequeues).toBe(0);
  });

  test("a queue that refuses the first of two files is asked once", async () => {
    const a = await twoStuck();
    added.length = 0;
    accepted = 0;
    acceptOnly = 0;
    try {
      const report = await requeueStuck(a.mongo, queue, a.workspaceId, {
        log: () => {},
      });
      expect(report).toEqual({ requeued: 0, failed: 0, nodesLeft: 2 });
      expect(added).toEqual([]);
    } finally {
      acceptOnly = null;
    }
    expect(await a.status(a.key)).toBe(0);
    expect(await a.status(a.secondKey)).toBe(0);
  });

  test("a queue that accepts the first and refuses the second leaves one node", async () => {
    const a = await twoStuck();
    added.length = 0;
    accepted = 0;
    acceptOnly = 1;
    try {
      const report = await requeueStuck(a.mongo, queue, a.workspaceId, {
        log: () => {},
      });
      expect(report).toEqual({ requeued: 1, failed: 0, nodesLeft: 1 });
      expect(added.map((j) => j.key)).toEqual([a.key]);
    } finally {
      acceptOnly = null;
    }
    expect(await a.status(a.key)).toBe(1);
    expect(await a.status(a.secondKey)).toBe(0);
  });

  test("the sweep of a workspace never throws for the stuck scan", async () => {
    const a = await stuckFile();
    const find = spyOn(a.mongo.db.nodes.raw, "find").mockImplementation(() => {
      throw new Error("mongo is away");
    });
    const logs: string[] = [];
    try {
      const report = await sweepWorkspace(
        a.mongo,
        {
          list: async () => ({ items: [], nextCursor: null }),
          delete: async () => {},
        } as never,
        a.workspaceId,
        { renditions: queue, log: (m) => logs.push(m) },
      );
      expect(report.failed).toBe(1);
      expect(report.stuck).toBeUndefined();
    } finally {
      find.mockRestore();
    }
    expect(logs.some((m) => m.includes("scan failed"))).toBe(true);
  });
});
