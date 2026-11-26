import { describe, expect, test } from "bun:test";
import { mediaWorld, text } from "./storage.media.harness";

// Through the real routes (`app.fetch`) on a real SeaweedFS and Redis.
const m = mediaWorld();

describe("/media on SeaweedFS: refusals", () => {
  test("an empty upload is 400 storage.errors.empty, an oversized one 413 too-large", async () => {
    const ws = m.state.wsA;
    const empty = await m.put(ws.owner, ws.id, "");
    expect(empty.status).toBe(400);
    expect(await m.codeOf(empty)).toBe("storage.errors.empty");
    const big = await m.call(ws.owner, ws.id, "/media/avatars", {
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
    const ws = m.state.wsA;
    const res = await m.put(ws.owner, ws.id, text, "text/plain", "avatars");
    expect(res.status).toBe(415);
    expect(await m.codeOf(res)).toBe("storage.errors.unsupported-type");
  });

  test("another workspace's key is a 404, even for a member of both", async () => {
    const a = m.state.wsA;
    const b = m.state.wsB;
    const { key } = await m.stored(a.owner, a.id);
    const other = await m.call(b.owner, b.id, `/media/files/${key}`);
    expect(other.status).toBe(404);
    expect(await m.codeOf(other)).toBe("storage.errors.not-found");
    // The object's own workspace and a non-member agree: 404.
    const outsider = await m.call(b.owner, a.id, `/media/files/${key}`);
    expect(outsider.status).toBe(404);
    expect(await m.codeOf(outsider)).toBe("storage.errors.not-found");
  });

  test("no session is 401, no workspace header 400, a key 401, in the error shape", async () => {
    const ws = m.state.wsA;
    const anon = await m.put(null, ws.id, text);
    expect(anon.status).toBe(401);
    expect(await m.codeOf(anon)).toBe("auth.errors.unauthenticated");
    const none = await m.put(ws.owner, undefined, text);
    expect(none.status).toBe(400);
    expect(await m.codeOf(none)).toBe("workspaces.errors.workspace-required");
    const read = await m.call(
      ws.owner,
      undefined,
      `/media/files/${crypto.randomUUID()}`,
    );
    expect(read.status).toBe(400);
  });

  test("the fourth upload in a minute is 429 rate-limited with Retry-After", async () => {
    const ws = m.state.wsA;
    for (let i = 0; i < 3; i++) await m.stored(ws.owner, ws.id);
    const res = await m.put(ws.owner, ws.id, text, "text/plain");
    expect(res.status).toBe(429);
    expect(await m.codeOf(res.clone())).toBe("storage.errors.rate-limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another account is not limited by it.
    const b = m.state.wsB;
    expect((await m.put(b.owner, b.id, text, "text/plain")).status).toBe(200);
  });
});
