import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { store } from "@/config/tenancy";
import { code, field } from "../../../test/files.area";
import {
  ADD,
  COPY,
  type FileView,
  filesWorld,
  png,
} from "../../../test/files.harness";
import { NODE, setup } from "../nodes/nodes.harness";
import { filesMongo } from "./files.handle";
import { makeRenditions } from "./files.renditions.make";
import { requeueStuck } from "./files.sweep.stuck";
import { type RenditionsQueue, renditionsHandler } from "./public";

// The queue is a switch the spec drives: jobs are held, not run, and the spec
// calls the handler itself, so each attempt of a job is its own step. `refuse`
// makes Redis refuse the next jobs.
let refuse = false;
const queue: RenditionsQueue = {
  add: async () => {
    if (refuse) throw new Error("redis is down");
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

async function record(body: Uint8Array, name: string) {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(
    workspace.owner,
    workspace.id,
    body,
    "image/png",
  );
  const result = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name, parentId: root.id } },
  });
  expect(result.errors).toBeUndefined();
  return {
    file: field<FileView>(result, "addFile"),
    workspace,
    root,
    at,
  };
}

// Runs one attempt of the job the handler would be given; `store` is the
// bucket the attempt reads from.
async function attempt(
  workspaceId: string,
  key: string,
  options: {
    attempt: number;
    attempts?: number;
    crops?: boolean;
    bucket?: typeof files.ctx.bucket;
  },
) {
  const handler = renditionsHandler({
    bucket: options.bucket ?? files.ctx.bucket,
    mongoOf: databaseOf,
  });
  return handler({
    data: { workspaceId, key, ...(options.crops && { crops: true }) },
    attempt: options.attempt,
    attempts: options.attempts ?? 3,
    signal: new AbortController().signal,
  } as never);
}

const statusOf = async (workspaceId: string, key: string) =>
  (await (await databaseOf(workspaceId)).db.nodes.findFirst({ blobKey: key }))
    ?.status;

describe("renditions that recover or fail", () => {
  test("a failure of the store on the first attempt, then success: READY", async () => {
    const { file, workspace } = await record(picture(), "retry.png");
    let opens = 0;
    const flaky = {
      ...files.ctx.bucket,
      open: (...args: Parameters<typeof files.ctx.bucket.open>) => {
        opens++;
        if (opens === 1) throw new Error("the store is away");
        return files.ctx.bucket.open(...args);
      },
    } as typeof files.ctx.bucket;
    await expect(
      attempt(workspace.id, file.key, { attempt: 1, bucket: flaky }),
    ).rejects.toThrow("the store is away");
    // Not the last attempt: the file waits for the retry.
    expect(await statusOf(workspace.id, file.key)).toBe("PROCESSING");
    await attempt(workspace.id, file.key, { attempt: 2, bucket: flaky });
    expect(await statusOf(workspace.id, file.key)).toBe("READY");
    const thumb = await files.call(
      workspace.owner,
      workspace.id,
      `/media/files/${file.key}/thumb`,
    );
    expect(thumb.status).toBe(200);
  });

  test("a node whose job has started is not picked up by the stuck sweep", async () => {
    const { file, workspace } = await record(picture(), "slow.png");
    const db = await databaseOf(workspace.id);
    await db.db.nodes.raw.updateMany(
      { blobKey: file.key },
      { $set: { renditionsAt: new Date(0) } },
    );
    const swept: unknown[] = [];
    let seen = false;
    const watching = {
      ...files.ctx.bucket,
      put: async (...args: Parameters<typeof files.ctx.bucket.put>) => {
        if (!seen) {
          seen = true;
          swept.push(await requeueStuck(db, queue, workspace.id));
        }
        return files.ctx.bucket.put(...args);
      },
    } as typeof files.ctx.bucket;
    await attempt(workspace.id, file.key, { attempt: 1, bucket: watching });
    expect(swept).toEqual([{ requeued: 0, failed: 0 }]);
    expect(await statusOf(workspace.id, file.key)).toBe("READY");
  });

  test("the beat before the stores keeps a slow render out of the stuck sweep", async () => {
    const { file, workspace } = await record(picture(), "slow2.png");
    const db = await databaseOf(workspace.id);
    const swept: unknown[] = [];
    let seen = false;
    // The read comes after the first beat: it makes the node look stuck again,
    // as a render slower than the threshold would.
    const slow = {
      ...files.ctx.bucket,
      open: async (...args: Parameters<typeof files.ctx.bucket.open>) => {
        await db.db.nodes.raw.updateMany(
          { blobKey: file.key },
          { $set: { renditionsAt: new Date(0) } },
        );
        return files.ctx.bucket.open(...args);
      },
      put: async (...args: Parameters<typeof files.ctx.bucket.put>) => {
        if (!seen) {
          seen = true;
          swept.push(await requeueStuck(db, queue, workspace.id));
        }
        return files.ctx.bucket.put(...args);
      },
    } as typeof files.ctx.bucket;
    await attempt(workspace.id, file.key, { attempt: 1, bucket: slow });
    expect(swept).toEqual([{ requeued: 0, failed: 0 }]);
    expect(await statusOf(workspace.id, file.key)).toBe("READY");
  });

  test("a copy made while the file is PROCESSING shares the job's outcome", async () => {
    const { file, workspace, root, at } = await record(picture(), "shared.png");
    expect(file.status).toBe("PROCESSING");
    const copied = await files.ctx.w.send(workspace.owner, COPY, {
      ...at,
      variables: { ids: [file.id], parentId: root.id },
    });
    expect(copied.errors).toBeUndefined();
    const db = await databaseOf(workspace.id);
    const both = () => db.db.nodes.findMany({ filter: { blobKey: file.key } });
    expect((await both()).map((n) => n.status)).toEqual([
      "PROCESSING",
      "PROCESSING",
    ]);
    await attempt(workspace.id, file.key, { attempt: 1 });
    expect((await both()).map((n) => n.status)).toEqual(["READY", "READY"]);
  });

  test("a crops job over an undecodable picture ends FAILED, without a retry", async () => {
    const { file, workspace } = await record(png(600), "bad.png");
    await expect(
      attempt(workspace.id, file.key, { attempt: 1, crops: true }),
    ).rejects.toThrow();
    expect(await statusOf(workspace.id, file.key)).toBe("FAILED");
  });

  test("a job Redis refuses during setFocalPoint leaves the file FAILED, the point kept", async () => {
    const { file, workspace, at } = await record(picture(), "focal.png");
    await attempt(workspace.id, file.key, { attempt: 1 });
    expect(await statusOf(workspace.id, file.key)).toBe("READY");
    refuse = true;
    try {
      const moved = await files.ctx.w.send(workspace.owner, FOCAL, {
        ...at,
        variables: { id: file.id, focalPoint: { x: 0.2, y: 0.3 } },
      });
      expect(code(moved)).toBeUndefined();
      expect(moved.data?.["setFocalPoint"]).toMatchObject({ status: "FAILED" });
    } finally {
      refuse = false;
    }
    const node = await (await databaseOf(workspace.id)).db.nodes.findFirst({
      blobKey: file.key,
    });
    expect(node?.status).toBe("FAILED");
    expect(node?.focalPoint).toEqual({ x: 0.2, y: 0.3 });
  });

  test("a crops-only render of a PDF makes nothing", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    expect(await makeRenditions(bytes, "pdf", { cropsOnly: true })).toEqual([]);
  });
});
