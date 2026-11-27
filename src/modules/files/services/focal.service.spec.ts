import { describe, expect, test } from "bun:test";
import { FOCAL, focalKit, READ } from "../../../../test/files.focal.harness";
import { filesWorld } from "../../../../test/files.harness";

const files = filesWorld({ renditions: true });
const { area, settled, crop } = focalKit(files);

describe("focal point and crops", () => {
  test("the four crops are made, centred, and listed once READY", async () => {
    const a = await area();
    const file = await a.record("two.png");
    expect(await settled(a.workspace.id, file.key)).toBe("READY");
    const read = await a.send(READ, { id: file.id });
    const node = read.data?.["node"] as {
      focalPoint: unknown;
      renditions: { preset: string }[];
      rendition: { size: string };
    };
    expect(node.focalPoint).toBeNull();
    expect(node.renditions.map((r) => r.preset)).toEqual([
      "THUMB",
      "PREVIEW",
      "SQUARE",
      "PORTRAIT",
      "STORY",
      "LANDSCAPE",
    ]);
    expect(node.rendition.size).toBe("thumb");
    const square = await crop(a, file.key, "square");
    expect(square).toMatchObject({
      type: "image/jpeg",
      width: 1000,
      height: 1000,
      left: "red",
      right: "blue",
    });
    const story = await crop(a, file.key, "story");
    expect(story.width / story.height).toBeCloseTo(9 / 16, 1);
  });

  test("a move redoes the crops around the point and changes their ETag", async () => {
    const a = await area();
    const file = await a.record("move.png");
    await settled(a.workspace.id, file.key);
    const before = await crop(a, file.key, "square");

    const moved = await a.send(FOCAL, {
      id: file.id,
      focalPoint: { x: 0.05, y: 0.5 },
    });
    expect(moved.errors).toBeUndefined();
    const view = moved.data?.["setFocalPoint"] as {
      status: string;
      cropsStatus: string;
      version: number;
      focalPoint: { x: number; y: number };
      renditions: unknown[];
      square: unknown;
    };
    // The file stays READY (its sizes stay listed) while the worker redoes
    // the crops: only `cropsStatus` is PROCESSING.
    expect(view.status).toBe("READY");
    expect(view.cropsStatus).toBe("PROCESSING");
    expect(view.focalPoint).toEqual({ x: 0.05, y: 0.5 });
    expect(view.renditions.length).toBeGreaterThan(0);
    expect(view.version).toBeGreaterThan(file.version);
    expect(await settled(a.workspace.id, file.key)).toBe("READY");
    const after = await a.send(READ, { id: file.id });
    expect(after.data?.["node"]).toMatchObject({
      status: "READY",
      cropsStatus: "READY",
    });

    const left = await crop(a, file.key, "square");
    expect(left).toMatchObject({ left: "red", right: "red" });
    expect(left.etag).toBeTruthy();
    expect(left.etag).not.toBe(before.etag);

    // Back across to the right, then to the centre again.
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.95, y: 0.5 } });
    await settled(a.workspace.id, file.key);
    const right = await crop(a, file.key, "square");
    expect(right).toMatchObject({ left: "blue", right: "blue" });
    expect(right.etag).not.toBe(left.etag);

    await a.send(FOCAL, { id: file.id, focalPoint: null });
    await settled(a.workspace.id, file.key);
    const centre = await crop(a, file.key, "square");
    expect(centre).toMatchObject({ left: "red", right: "blue" });
    expect(centre.etag).toBe(before.etag);
  });

  test("a move before the first job is done still ends READY with its crops", async () => {
    const a = await area();
    const file = await a.record("early.png");
    const moved = await a.send(FOCAL, {
      id: file.id,
      focalPoint: { x: 0.05, y: 0.5 },
    });
    expect(moved.errors).toBeUndefined();
    expect(await settled(a.workspace.id, file.key)).toBe("READY");
    const left = await crop(a, file.key, "square");
    expect(left).toMatchObject({ left: "red", right: "red" });
  });

  test("a revalidation with the old ETag is answered with the new crop", async () => {
    const a = await area();
    const file = await a.record("etag.png");
    await settled(a.workspace.id, file.key);
    const before = await crop(a, file.key, "square");
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0, y: 0 } });
    await settled(a.workspace.id, file.key);
    const res = await files.call(
      a.workspace.owner,
      a.workspace.id,
      `/media/files/${file.key}/square`,
      { headers: { "if-none-match": before.etag ?? "" } },
    );
    expect(res.status).toBe(200);
  });
});
