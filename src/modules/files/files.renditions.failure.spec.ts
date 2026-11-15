import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineRedis, openRedis } from "@softistx/redis";
import { store } from "@/config/tenancy";
import { defineRenditionsQueue } from "@/queues/renditions";
import {
  ADD,
  type FileView,
  filesWorld,
  png,
} from "../../../test/files.harness";
import { setup } from "../nodes/nodes.harness";
import type { RenditionsQueue } from "./public";
import {
  type FilesMongo,
  markRenditionsFailed,
  renditionsHandler,
} from "./public";

// What fails: Redis refusing a job, and the store failing under a job. The
// queue the app gets is a switch over the real one, so a spec picks.
let real: RenditionsQueue | undefined;
const queue: RenditionsQueue = {
  add: async (job, options) => {
    if (!real) throw new Error("redis is down");
    return real.add(job, options);
  },
};
const files = filesWorld({ renditions: queue });

const databaseOf = async (id: string) =>
  (await store.databaseOf(id)) as unknown as FilesMongo;

let opens = 0;
let closeRedis: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const appRedis = await openRedis(
    defineRedis({
      client: files.ctx.client,
      queues: {
        renditions: defineRenditionsQueue({
          attempts: 3,
          backoff: { base: "50ms", max: "100ms" },
        }),
      },
    }),
  );
  // The store answers every read with an error, and counts the tries.
  const broken = {
    ...files.ctx.bucket,
    open: async () => {
      opens++;
      throw new Error("the store is away");
    },
  };
  appRedis.queues.renditions.work(
    renditionsHandler({
      bucket: broken,
      mongoOf: async (id) => databaseOf(id),
    }),
    { concurrency: 1 },
  );
  real = appRedis.queues.renditions;
  closeRedis = () => appRedis.close({ grace: "1s" });
});
afterAll(async () => {
  await closeRedis?.();
});

async function record(name: string) {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(
    workspace.owner,
    workspace.id,
    png(400),
    "image/png",
  );
  const result = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name, parentId: root.id } },
  });
  expect(result.errors).toBeUndefined();
  return { file: result.data?.["addFile"] as FileView, workspace };
}

describe("renditions that fail", () => {
  test("a job Redis refuses leaves the file FAILED and readable", async () => {
    const saved = real;
    real = undefined;
    try {
      const { file, workspace } = await record("a.png");
      expect(file.status).toBe("FAILED");
      const db = await databaseOf(workspace.id);
      expect((await db.db.nodes.findFirst({ blobKey: file.key }))?.status).toBe(
        "FAILED",
      );
      const original = await files.call(
        workspace.owner,
        workspace.id,
        `/media/files/${file.key}`,
      );
      expect(original.status).toBe(200);
    } finally {
      real = saved;
    }
  });

  test("a failure of the store is retried, then the file is FAILED", async () => {
    opens = 0;
    const { file, workspace } = await record("b.png");
    expect(file.status).toBe("PROCESSING");
    const db = await databaseOf(workspace.id);
    for (let i = 0; i < 200; i++) {
      const node = await db.db.nodes.findFirst({ blobKey: file.key });
      if (node?.status !== "PROCESSING") break;
      await Bun.sleep(100);
    }
    expect((await db.db.nodes.findFirst({ blobKey: file.key }))?.status).toBe(
      "FAILED",
    );
    // Three attempts, spent on the store, not one.
    expect(opens).toBe(3);
  });

  test("a job that failed for good without its handler marks the file FAILED", async () => {
    const saved = real;
    real = { add: async () => ({}) };
    try {
      const { file, workspace } = await record("c.png");
      expect(file.status).toBe("PROCESSING");
      await markRenditionsFailed(
        { mongoOf: databaseOf },
        `${workspace.id}:${file.key}`,
      );
      const db = await databaseOf(workspace.id);
      expect((await db.db.nodes.findFirst({ blobKey: file.key }))?.status).toBe(
        "FAILED",
      );
    } finally {
      real = saved;
    }
  });
});
