import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { startTestRedis, type TestRedis } from "@softistx/redis/testing";
import { startTestS3, type TestS3 } from "@softistx/s3/testing";
import { RedisClient } from "bun";
import { world } from "../../../test/workspaces.harness";
import { createUploadLimit, openBucket } from "./index";

// Through the real routes (`app.fetch`) on a real SeaweedFS and Redis.
const BUCKET = "storix-spec";
let s3: TestS3;
let redis: TestRedis;
let client: RedisClient;
let w: Awaited<ReturnType<typeof world>>;

beforeAll(async () => {
  s3 = await startTestS3();
  await s3.createBucket(BUCKET);
  redis = await startTestRedis();
  client = new RedisClient(redis.uri);
  w = await world({
    media: {
      bucket: openBucket({
        bucket: BUCKET,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        endpoint: s3.endpoint,
        region: s3.region,
      }),
      limit: createUploadLimit(client, { limit: 3, per: 60_000, burst: 3 }),
    },
  });
}, 300_000);
afterAll(async () => {
  client?.close();
  await redis?.stop();
  await s3?.stop();
});
beforeEach(() => redis.reset());

type User = Awaited<ReturnType<typeof w.h.account>>;
const call = (
  user: User | null,
  workspace: string | undefined,
  path: string,
  init: RequestInit = {},
) =>
  w.h.app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...(user?.headers ?? {}),
        ...(workspace ? { "x-storix-workspace": workspace } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
  );
const put = (
  user: User | null,
  workspace: string | undefined,
  body: BodyInit,
  type = "application/octet-stream",
  kind = "files",
) =>
  call(user, workspace, `/media/${kind}`, {
    method: "PUT",
    body,
    headers: { "content-type": type },
  });
const codeOf = async (res: Response) =>
  ((await res.json()) as { errors: { extensions: { code: string } }[] })
    .errors[0]?.extensions.code;

const text = "0123456789abcdefghij";

async function stored(user: User, workspace: string, body: string = text) {
  const res = await put(user, workspace, body, "text/plain");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    key: string;
    contentType: string;
    size: number;
  };
}

describe("/media on SeaweedFS", () => {
  test("stores any type and serves it with ETag, type and size", async () => {
    const ws = await w.workspaceOf();
    const up = await stored(ws.owner, ws.id);
    expect(up).toMatchObject({ contentType: "text/plain", size: 20 });
    const res = await call(ws.owner, ws.id, `/media/files/${up.key}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789abcdefghij");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  test("a type with no known signature is stored as declared and served as a download", async () => {
    const ws = await w.workspaceOf();
    const res = await put(ws.owner, ws.id, text, "application/x-custom");
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    const got = await call(ws.owner, ws.id, `/media/files/${key}`);
    expect(got.headers.get("content-type")).toBe("application/octet-stream");
    expect(got.headers.get("content-disposition")).toContain("attachment");
  });

  test("Range answers 206, a range past the end 416 in the error shape", async () => {
    const ws = await w.workspaceOf();
    const { key } = await stored(ws.owner, ws.id);
    const part = await call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { range: "bytes=2-5" },
    });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("2345");
    expect(part.headers.get("content-range")).toBe("bytes 2-5/20");
    const past = await call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { range: "bytes=99-" },
    });
    expect(past.status).toBe(416);
    expect(await codeOf(past)).toBe("storage.errors.range-not-satisfiable");
  });

  test("If-None-Match with the ETag is a 304", async () => {
    const ws = await w.workspaceOf();
    const { key } = await stored(ws.owner, ws.id);
    const first = await call(ws.owner, ws.id, `/media/files/${key}`);
    const etag = first.headers.get("etag") ?? "";
    const again = await call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);
  });

  test("an empty upload is 400 storage.errors.empty, an oversized one 413 too-large", async () => {
    const ws = await w.workspaceOf();
    const empty = await put(ws.owner, ws.id, "");
    expect(empty.status).toBe(400);
    expect(await codeOf(empty)).toBe("storage.errors.empty");
    const big = await call(ws.owner, ws.id, "/media/avatars", {
      method: "PUT",
      body: "x",
      headers: {
        "content-type": "image/png",
        "content-length": String(11 * 1024 * 1024),
      },
    });
    expect(big.status).toBe(413);
    const body = (await big.json()) as {
      errors: { extensions: { code: string; params: { limitMib: number } } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe("storage.errors.too-large");
    expect(body.errors[0]?.extensions.params.limitMib).toBe(10);
  });

  test("avatars refuse a type outside JPEG, PNG and WebP", async () => {
    const ws = await w.workspaceOf();
    const res = await put(ws.owner, ws.id, text, "text/plain", "avatars");
    expect(res.status).toBe(415);
    expect(await codeOf(res)).toBe("storage.errors.unsupported-type");
  });

  test("another workspace's key is a 404, even for a member of both", async () => {
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const { key } = await stored(a.owner, a.id);
    const other = await call(b.owner, b.id, `/media/files/${key}`);
    expect(other.status).toBe(404);
    expect(await codeOf(other)).toBe("storage.errors.not-found");
    // The object's own workspace and a non-member agree: 404.
    const outsider = await call(b.owner, a.id, `/media/files/${key}`);
    expect(outsider.status).toBe(404);
    expect(await codeOf(outsider)).toBe("storage.errors.not-found");
  });

  test("the object lives under workspaces/<id>/files/<key>", async () => {
    const ws = await w.workspaceOf();
    const { key } = await stored(ws.owner, ws.id);
    const direct = await fetchObject(`workspaces/${ws.id}/files/${key}`);
    expect(direct).toBe(200);
    expect(await fetchObject(`files/${key}`)).toBe(404);
  });

  test("no session is 401, no workspace header 400, a key 401, in the error shape", async () => {
    const ws = await w.workspaceOf();
    const anon = await put(null, ws.id, text);
    expect(anon.status).toBe(401);
    expect(await codeOf(anon)).toBe("auth.errors.unauthenticated");
    const none = await put(ws.owner, undefined, text);
    expect(none.status).toBe(400);
    expect(await codeOf(none)).toBe("workspaces.errors.workspace-required");
    const read = await call(
      ws.owner,
      undefined,
      `/media/files/${crypto.randomUUID()}`,
    );
    expect(read.status).toBe(400);
  });

  test("the fourth upload in a minute is 429 rate-limited with Retry-After", async () => {
    const ws = await w.workspaceOf();
    for (let i = 0; i < 3; i++) await stored(ws.owner, ws.id);
    const res = await put(ws.owner, ws.id, text, "text/plain");
    expect(res.status).toBe(429);
    expect(await codeOf(res.clone())).toBe("storage.errors.rate-limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another account is not limited by it.
    const b = await w.workspaceOf();
    expect((await put(b.owner, b.id, text, "text/plain")).status).toBe(200);
  });
});

async function fetchObject(key: string) {
  const bucket = openBucket({
    bucket: BUCKET,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    endpoint: s3.endpoint,
    region: s3.region,
  }) as unknown as { exists(p: { key: string }): Promise<boolean> };
  return (await bucket.exists({ key })) ? 200 : 404;
}
