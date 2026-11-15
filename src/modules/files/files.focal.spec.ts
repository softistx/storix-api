import { describe, expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { store } from "@/config/tenancy";
import { actionsOf, storedEvents } from "@/core/audit/audit.harness";
import {
  ADD,
  COPY,
  type FileView,
  filesWorld,
} from "../../../test/files.harness";
import { NODE, setup } from "../nodes/nodes.harness";
import type { FilesMongo } from "./files.service";

const files = filesWorld({ renditions: true });

const FOCAL = `mutation($id: ID!, $focalPoint: FocalPointInput) {
  setFocalPoint(id: $id, focalPoint: $focalPoint) {
    ${NODE} key status focalPoint { x y }
    renditions { preset size mimeType }
    square: rendition(preset: SQUARE) { size }
    story: rendition(preset: STORY) { size }
  }
}`;
const READ = `query($id: ID!) { node(id: $id) { ... on File {
  focalPoint { x y } renditions { preset size } rendition(preset: THUMB) { size }
} } }`;

const databaseOf = async (id: string) =>
  (await store.databaseOf(id)) as unknown as FilesMongo;

// A field of an answer's data; throws when the call returned none.
function field<T>(r: { data?: Record<string, unknown> | null }, name: string) {
  const value = r.data?.[name];
  if (value === undefined) throw new Error(`no ${name} answered`);
  return value as T;
}

const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;

// Left half red, right half blue: where a crop lands shows in its pixels.
function picture(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = "#0000ff";
  context.fillRect(width / 2, 0, width / 2, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

async function area(
  body: Uint8Array = picture(2000, 1000),
  type = "image/png",
) {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const send = (query: string, variables: Record<string, unknown>) =>
    files.ctx.w.send(workspace.owner, query, { ...at, variables });
  const record = async (name: string, content = body, mime = type) => {
    const up = await files.upload(workspace.owner, workspace.id, content, mime);
    const added = await send(ADD, {
      input: { key: up.key, name, parentId: root.id },
    });
    expect(added.errors).toBeUndefined();
    return field<FileView>(added, "addFile");
  };
  return { workspace, root, owner, send, record };
}

async function settled(workspaceId: string, key: string) {
  const db = await databaseOf(workspaceId);
  for (let i = 0; i < 300; i++) {
    const node = await db.db.nodes.findFirst({ blobKey: key });
    if (node && node.status !== "PROCESSING") return node.status;
    await Bun.sleep(100);
  }
  throw new Error("the renditions did not settle");
}

// A crop as served: its ETag and the colours of its left and right edges.
async function crop(
  a: Awaited<ReturnType<typeof area>>,
  key: string,
  name: string,
) {
  const res = await files.call(
    a.workspace.owner,
    a.workspace.id,
    `/media/files/${key}/${name}`,
  );
  expect(res.status).toBe(200);
  const image = await loadImage(Buffer.from(await res.arrayBuffer()));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const at = (x: number) => {
    const [r = 0, , b = 0] = context.getImageData(
      x,
      image.height / 2,
      1,
      1,
    ).data;
    return r > b ? "red" : "blue";
  };
  return {
    etag: res.headers.get("etag"),
    type: res.headers.get("content-type"),
    width: image.width,
    height: image.height,
    left: at(2),
    right: at(image.width - 3),
  };
}

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
      version: number;
      focalPoint: { x: number; y: number };
      renditions: unknown[];
      square: unknown;
    };
    // PROCESSING while the worker redoes them: nothing is listed meanwhile.
    expect(view.status).toBe("PROCESSING");
    expect(view.focalPoint).toEqual({ x: 0.05, y: 0.5 });
    expect(view.renditions).toEqual([]);
    expect(view.square).toBeNull();
    expect(view.version).toBeGreaterThan(file.version);
    expect(await settled(a.workspace.id, file.key)).toBe("READY");

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

  test("a copy shares the point; the move is audited without its values", async () => {
    const a = await area();
    const file = await a.record("shared.png");
    await settled(a.workspace.id, file.key);
    const dir = await a.owner.folder(a.root.id, "dir");
    const copied = await a.send(COPY, { ids: [file.id], parentId: dir.id });
    const [copy] = field<{ id: string }[]>(copied, "copyNodes");
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.9, y: 0.1 } });
    await settled(a.workspace.id, file.key);
    const read = await a.send(READ, { id: copy?.id });
    expect(field<{ focalPoint: unknown }>(read, "node").focalPoint).toEqual({
      x: 0.9,
      y: 0.1,
    });
    const events = await storedEvents(a.workspace.id);
    expect(actionsOf(events)).toContain("file.focal");
    const event = events.find((one) => one.action === "file.focal");
    expect(event?.target?.name).toBe("shared.png");
    expect(JSON.stringify(event)).not.toContain("0.9");
  });

  test("a folder, a non-picture and a bad point are refused", async () => {
    const a = await area();
    const dir = await a.owner.folder(a.root.id, "dir");
    expect(
      code(await a.send(FOCAL, { id: dir.id, focalPoint: { x: 0, y: 0 } })),
    ).toBe("files.errors.not-a-file");
    const text = await a.record(
      "a.txt",
      new TextEncoder().encode("hello"),
      "text/plain",
    );
    expect(
      code(await a.send(FOCAL, { id: text.id, focalPoint: { x: 0, y: 0 } })),
    ).toBe("files.errors.not-renderable");
    const file = await a.record("p.png");
    await settled(a.workspace.id, file.key);
    for (const focalPoint of [
      { x: 1.01, y: 0.5 },
      { x: 0.5, y: -0.1 },
    ]) {
      const refused = await a.send(FOCAL, { id: file.id, focalPoint });
      expect(code(refused)).toBe("files.errors.invalid-focal");
    }
    // Nothing moved, nothing queued: the file is still READY.
    const read = await a.send(READ, { id: file.id });
    expect(field<{ focalPoint: unknown }>(read, "node").focalPoint).toBeNull();
    expect(await settled(a.workspace.id, file.key)).toBe("READY");
  });

  test("a node of another workspace is not found", async () => {
    const a = await area();
    const file = await a.record("p.png");
    const other = await files.ctx.w.workspaceOf();
    const result = await files.ctx.w.send(other.owner, FOCAL, {
      workspace: other.id,
      variables: { id: file.id, focalPoint: { x: 0, y: 0 } },
    });
    expect(code(result)).toBe("nodes.errors.not-found");
  });
});
