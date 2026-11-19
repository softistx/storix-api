import { describe, expect, spyOn, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { store } from "@/config/tenancy";
import { field } from "../../../test/files.area";
import { ADD, type FileView, filesWorld } from "../../../test/files.harness";
import { NODE, setup } from "../nodes/nodes.harness";
import { filesMongo } from "./files.handle";
import { renditionsOf } from "./files.renditions.list";
import { requeueStuck } from "./files.sweep.stuck";
import { type RenditionsQueue, renditionsHandler } from "./public";

// A queue that holds its jobs: the spec calls the handler itself.
const added: string[] = [];
const queue: RenditionsQueue = {
  add: async (job) => {
    added.push(job.key);
    return {};
  },
};
const files = filesWorld({ renditions: queue });
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

function picture() {
  const canvas = createCanvas(800, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "#3355aa";
  context.fillRect(0, 0, 800, 400);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

const FOCAL = `mutation($id: ID!, $focalPoint: FocalPointInput) {
  setFocalPoint(id: $id, focalPoint: $focalPoint) { ${NODE} status }
}`;

async function record(name: string) {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(
    workspace.owner,
    workspace.id,
    picture(),
    "image/png",
  );
  const sent = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name, parentId: root.id } },
  });
  expect(sent.errors).toBeUndefined();
  const file = field<FileView>(sent, "addFile");
  const mongo = await databaseOf(workspace.id);
  const node = () => mongo.db.nodes.findFirst({ blobKey: file.key });
  const run = async (options: { crops?: boolean } = {}) =>
    renditionsHandler({ bucket: files.ctx.bucket, mongoOf: databaseOf })({
      data: {
        workspaceId: workspace.id,
        key: file.key,
        ...(options.crops && { crops: true }),
      },
      attempt: 1,
      attempts: 3,
      signal: new AbortController().signal,
    } as never);
  return { file, workspace, at, mongo, node, run };
}

describe("renditions settle by success", () => {
  test("a backlog that left the file FAILED does not outlive the original job", async () => {
    const a = await record("backlog.png");
    const old = new Date(0);
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.file.key },
      { $set: { renditionsAt: old } },
    );
    // The sweep gives up on it after maxRequeues requeues...
    const later = new Date(Date.now() + 2 * 3_600_000);
    for (let i = 0; i < 2; i++) {
      await requeueStuck(a.mongo, queue, a.workspace.id, {
        now: () => later,
        maxRequeues: 1,
      });
      await a.mongo.db.nodes.raw.updateMany(
        { blobKey: a.file.key },
        { $set: { renditionsAt: old } },
      );
    }
    expect((await a.node())?.status).toBe("FAILED");
    // ...then the original job, finally served, settles it.
    await a.run();
    const node = await a.node();
    expect(node?.status).toBe("READY");
    expect(node?.renditionRequeues).toBe(0);
    expect(
      renditionsOf({ mimeType: node?.mimeType ?? "", status: "READY" }).length,
    ).toBeGreaterThan(0);
    const thumb = await files.call(
      a.workspace.owner,
      a.workspace.id,
      `/media/files/${a.file.key}/thumb`,
    );
    expect(thumb.status).toBe(200);
  });

  test("a crops job never settles a FAILED file", async () => {
    const a = await record("crops.png");
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.file.key },
      { $set: { status: "FAILED" } },
    );
    await a.run({ crops: true });
    expect((await a.node())?.status).toBe("FAILED");
  });

  test("READY resets the requeue counter", async () => {
    const a = await record("reset.png");
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.file.key },
      { $set: { renditionRequeues: 2 } },
    );
    await a.run();
    expect((await a.node())?.renditionRequeues).toBe(0);
  });

  test("a new PROCESSING starts afresh (setFocalPoint)", async () => {
    const a = await record("focal.png");
    await a.run();
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.file.key },
      { $set: { renditionRequeues: 2, renditionsAt: new Date(0) } },
    );
    const moved = await files.ctx.w.send(a.workspace.owner, FOCAL, {
      ...a.at,
      variables: { id: a.file.id, focalPoint: { x: 0.2, y: 0.3 } },
    });
    expect(moved.errors).toBeUndefined();
    const node = await a.node();
    expect(node?.status).toBe("PROCESSING");
    expect(node?.renditionRequeues).toBe(0);
    expect(node?.renditionsAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  test("a new file starts with a renditionsAt", async () => {
    const a = await record("new.png");
    expect((await a.node())?.renditionsAt).toBeInstanceOf(Date);
  });

  test("the heartbeat and the sweep leave updatedAt alone", async () => {
    const a = await record("quiet.png");
    const before = (await a.node())?.updatedAt;
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: a.file.key },
      { $set: { renditionsAt: new Date(0) } },
    );
    await requeueStuck(a.mongo, queue, a.workspace.id, {
      now: () => new Date(Date.now() + 2 * 3_600_000),
    });
    expect((await a.node())?.updatedAt).toEqual(before as Date);
    await a.run();
    expect((await a.node())?.updatedAt).toEqual(before as Date);
  });

  test("a heartbeat that throws does not fail the job", async () => {
    const a = await record("beat.png");
    // The collection class of the driver the store runs on.
    const proto = Object.getPrototypeOf(a.mongo.db.nodes.raw) as {
      updateMany: (...args: unknown[]) => unknown;
    };
    const original = proto.updateMany;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const beat = spyOn(proto, "updateMany").mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      const update = args[1] as { $set?: Record<string, unknown> };
      if (update?.$set && "renditionsAt" in update.$set) {
        throw new Error("mongo blip");
      }
      return (original as (...a: unknown[]) => unknown).apply(
        this,
        args,
      ) as never;
    } as never);
    let warned = 0;
    try {
      await a.run();
    } finally {
      warned = warn.mock.calls.length;
      beat.mockRestore();
      warn.mockRestore();
    }
    expect((await a.node())?.status).toBe("READY");
    expect(warned).toBeGreaterThan(0);
  });
});
