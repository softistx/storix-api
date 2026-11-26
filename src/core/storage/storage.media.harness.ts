import { afterAll, beforeAll, beforeEach, expect } from "bun:test";
import { startTestRedis, type TestRedis } from "@softistx/redis/testing";
import { startTestS3, type TestS3 } from "@softistx/s3/testing";
import { RedisClient } from "bun";
import { world } from "../../../test/workspaces.harness";
import { createUploadLimit, openBucket } from "./index";

type World = Awaited<ReturnType<typeof world>>;
type Workspace = Awaited<ReturnType<World["workspaceOf"]>>;
type User = Awaited<ReturnType<World["h"]["account"]>>;

export const text = "0123456789abcdefghij";
const BUCKET = "storix-spec";

// Through the real routes (`app.fetch`) on a real SeaweedFS and Redis: the
// hooks of one spec file, and the calls its tests make.
export function mediaWorld() {
  let s3: TestS3;
  let redis: TestRedis;
  let client: RedisClient;
  const state = {} as { w: World; wsA: Workspace; wsB: Workspace };

  beforeAll(async () => {
    s3 = await startTestS3();
    await s3.createBucket(BUCKET);
    redis = await startTestRedis();
    client = new RedisClient(redis.uri);
    state.w = await world({
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
    // Two workspaces with their own owners, made once: provisioning a
    // workspace database costs about a second, and the tests only need one
    // that is theirs.
    [state.wsA, state.wsB] = [
      await state.w.workspaceOf(),
      await state.w.workspaceOf(),
    ];
  }, 300_000);
  afterAll(async () => {
    client?.close();
    await redis?.stop();
    await s3?.stop();
  });
  beforeEach(() => redis.reset());

  const call = (
    user: User | null,
    workspace: string | undefined,
    path: string,
    init: RequestInit = {},
  ) =>
    state.w.h.app.fetch(
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

  // Uploads, then records the object as a file in the caller's root: `files`
  // reads only serve a key a live node of the caller's own tree holds.
  async function stored(
    user: User,
    workspace: string,
    body: string = text,
    type = "text/plain",
  ) {
    const res = await put(user, workspace, body, type);
    expect(res.status).toBe(200);
    const up = (await res.json()) as {
      key: string;
      contentType: string;
      size: number;
    };
    const roots = await state.w.send(user, "{ roots { id } }", { workspace });
    const parentId = ((roots.data?.["roots"] ?? []) as { id: string }[])[0]?.id;
    const added = await state.w.send(
      user,
      "mutation($input: AddFileInput!) { addFile(input: $input) { id } }",
      {
        workspace,
        variables: {
          input: { key: up.key, name: `f-${up.key}.txt`, parentId },
        },
      },
    );
    expect(added.errors).toBeUndefined();
    return up;
  }

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

  return { state, call, put, codeOf, stored, fetchObject };
}
