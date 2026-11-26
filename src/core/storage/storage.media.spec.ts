import { describe, expect, test } from "bun:test";
import { mediaWorld, text } from "./storage.media.harness";

// Through the real routes (`app.fetch`) on a real SeaweedFS and Redis.
const m = mediaWorld();

describe("/media on SeaweedFS: reads", () => {
  test("stores any type and serves it with ETag, type and size", async () => {
    const ws = m.state.wsA;
    const up = await m.stored(ws.owner, ws.id);
    expect(up).toMatchObject({ contentType: "text/plain", size: 20 });
    const res = await m.call(ws.owner, ws.id, `/media/files/${up.key}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789abcdefghij");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  test("a type with no known signature is stored as declared and served as a download", async () => {
    const ws = m.state.wsA;
    const { key } = await m.stored(
      ws.owner,
      ws.id,
      text,
      "application/x-custom",
    );
    const got = await m.call(ws.owner, ws.id, `/media/files/${key}`);
    expect(got.headers.get("content-type")).toBe("application/octet-stream");
    expect(got.headers.get("content-disposition")).toContain("attachment");
  });

  test("Range answers 206, a range past the end 416 in the error shape", async () => {
    const ws = m.state.wsA;
    const { key } = await m.stored(ws.owner, ws.id);
    const part = await m.call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { range: "bytes=2-5" },
    });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("2345");
    expect(part.headers.get("content-range")).toBe("bytes 2-5/20");
    const past = await m.call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { range: "bytes=99-" },
    });
    expect(past.status).toBe(416);
    expect(await m.codeOf(past)).toBe("storage.errors.range-not-satisfiable");
  });

  test("If-None-Match with the ETag is a 304", async () => {
    const ws = m.state.wsA;
    const { key } = await m.stored(ws.owner, ws.id);
    const first = await m.call(ws.owner, ws.id, `/media/files/${key}`);
    const etag = first.headers.get("etag") ?? "";
    const again = await m.call(ws.owner, ws.id, `/media/files/${key}`, {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);
  });

  test("the object lives under workspaces/<id>/files/<key>", async () => {
    const ws = m.state.wsA;
    const { key } = await m.stored(ws.owner, ws.id);
    const direct = await m.fetchObject(`workspaces/${ws.id}/files/${key}`);
    expect(direct).toBe(200);
    expect(await m.fetchObject(`files/${key}`)).toBe(404);
  });
});
