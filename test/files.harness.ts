import { afterAll, beforeAll, beforeEach } from "bun:test";
import { defineRedis, openRedis } from "@softistx/redis";
import { startTestRedis, type TestRedis } from "@softistx/redis/testing";
import { startTestS3, type TestS3 } from "@softistx/s3/testing";
import { RedisClient } from "bun";
import { store } from "@/config/tenancy";
import { createUploadLimit, openBucket } from "@/core/storage";
import {
  type FilesMongo,
  type RenditionsQueue,
  renditionsHandler,
} from "@/modules/files/public";
import { defineRenditionsQueue } from "@/queues/renditions";
import { NODE } from "../src/modules/nodes/nodes.harness";
import { world } from "./workspaces.harness";

export const BUCKET = "storix-files-spec";

export const FILE = `${NODE} key mimeType size family tags meta status`;
export const ADD = `mutation($input: AddFileInput!) { addFile(input: $input) { ${FILE} } }`;

export const COPY = `mutation($ids: [ID!]!, $parentId: ID!) { copyNodes(ids: $ids, parentId: $parentId) { ${NODE} } }`;
export const UPDATE = `mutation($id: ID!, $input: UpdateFileInput!) { updateFile(id: $id, input: $input) { ${FILE} } }`;

export interface FileView {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  key: string;
  mimeType: string;
  size: number;
  family: string;
  tags: string[];
  meta: Record<string, unknown>;
  version: number;
  status: string;
}

// The file an `addFile` answered; throws when it was refused.
export function fileOf(result: { data?: Record<string, unknown> | null }) {
  const file = result.data?.["addFile"] as FileView | undefined;
  if (!file) throw new Error("no file answered");
  return file;
}

type World = Awaited<ReturnType<typeof world>>;
export type User = Awaited<ReturnType<World["h"]["account"]>>;

// A real SeaweedFS and Redis behind `/media`, started once per spec file, and
// the world of workspaces over them. Call it at the top of the file; the hooks
// it registers stop everything afterwards.
//
// `renditions: true` runs the real queue and its worker over that Redis, with
// a short backoff; a queue passed instead is handed to the app as it is, and no
// worker runs.
export function filesWorld(
  options: { renditions?: true | RenditionsQueue } = {},
) {
  const ctx = {} as {
    appRedis: Awaited<ReturnType<typeof openRenditions>> | undefined;
    s3: TestS3;
    redis: TestRedis;
    client: RedisClient;
    w: World;
    bucket: ReturnType<typeof openBucket>;
  };
  beforeAll(async () => {
    ctx.s3 = await startTestS3();
    await ctx.s3.createBucket(BUCKET);
    ctx.redis = await startTestRedis();
    ctx.client = new RedisClient(ctx.redis.uri);
    ctx.bucket = openBucket({
      bucket: BUCKET,
      accessKeyId: ctx.s3.accessKeyId,
      secretAccessKey: ctx.s3.secretAccessKey,
      endpoint: ctx.s3.endpoint,
      region: ctx.s3.region,
    });
    if (options.renditions === true) ctx.appRedis = await openRenditions(ctx);
    ctx.w = await world({
      ...(options.renditions && {
        renditions:
          options.renditions === true
            ? ctx.appRedis?.queues.renditions
            : options.renditions,
      }),
      media: {
        bucket: ctx.bucket,
        limit: createUploadLimit(ctx.client, {
          limit: 1000,
          per: 60_000,
          burst: 1000,
        }),
      },
    });
  }, 300_000);
  afterAll(async () => {
    await ctx.appRedis?.close({ grace: "2s" });
    ctx.client?.close();
    await ctx.redis?.stop();
    await ctx.s3?.stop();
  });
  beforeEach(() => ctx.redis.reset());

  const call = (
    user: User | null,
    workspace: string | undefined,
    path: string,
    init: RequestInit = {},
  ) =>
    ctx.w.h.app.fetch(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: {
          ...(user?.headers ?? {}),
          ...(workspace ? { "x-storix-workspace": workspace } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      }),
    );

  // `PUT /media/<kind>`: the object stored, and the key it answers.
  async function upload(
    user: User,
    workspace: string,
    body: string | Uint8Array,
    type = "text/plain",
    kind = "files",
  ) {
    // The declared length, as a client sends it: the quota reads it.
    const length =
      typeof body === "string"
        ? new TextEncoder().encode(body).length
        : body.length;
    const res = await call(user, workspace, `/media/${kind}`, {
      method: "PUT",
      body: body as BodyInit,
      headers: { "content-type": type, "content-length": String(length) },
    });
    if (res.status !== 200) throw new Error(`upload ${res.status}`);
    return (await res.json()) as {
      key: string;
      contentType: string;
      size: number;
    };
  }

  // Uploads a body and records it as a file; throws on a refusal.
  async function addFile(
    user: User,
    workspace: string,
    parentId: string,
    name: string,
    body: string | Uint8Array = name,
    type = "text/plain",
  ) {
    const up = await upload(user, workspace, body, type);
    const result = await ctx.w.send(user, ADD, {
      workspace,
      variables: { input: { key: up.key, name, parentId } },
    });
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    return result.data?.["addFile"] as FileView;
  }

  return { ctx, call, upload, addFile };
}

// Bodies the storage's signature check accepts as an image and a PDF, `size`
// bytes long.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const png = (size: number) =>
  Uint8Array.from({ length: size }, (_, i) => PNG_SIGNATURE[i] ?? 0);
export const pdf = (size: number) =>
  new TextEncoder().encode("%PDF-1.4".padEnd(size, " "));

// The `renditions` queue over the spec's Redis, and its worker over the spec's
// bucket and databases.
async function openRenditions(ctx: {
  client: RedisClient;
  bucket: ReturnType<typeof openBucket>;
}) {
  const appRedis = await openRedis(
    defineRedis({
      client: ctx.client,
      queues: {
        renditions: defineRenditionsQueue({
          attempts: 3,
          backoff: { base: "50ms", max: "200ms" },
        }),
      },
    }),
  );
  appRedis.queues.renditions.work(
    renditionsHandler({
      bucket: ctx.bucket,
      mongoOf: async (id) =>
        (await store.databaseOf(id)) as unknown as FilesMongo,
    }),
    { concurrency: 2 },
  );
  return appRedis;
}
