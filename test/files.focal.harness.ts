import { expect } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { store } from "@/config/tenancy";
import { filesMongo } from "../src/modules/files/models";
import { NODE, setup } from "../src/modules/nodes/nodes.harness";
import { field } from "./files.area";
import { ADD, type FileView, type filesWorld } from "./files.harness";

// What the focal-point specs share: the two queries, a two-coloured
// picture, and the helpers that need the world (an area, waiting for the
// renditions, reading a served crop).
type Files = ReturnType<typeof filesWorld>;

export const FOCAL = `mutation($id: ID!, $focalPoint: FocalPointInput) {
  setFocalPoint(id: $id, focalPoint: $focalPoint) {
    ${NODE} key status focalPoint { x y }
    renditions { preset size mimeType }
    square: rendition(preset: SQUARE) { size }
    story: rendition(preset: STORY) { size }
  }
}`;
export const READ = `query($id: ID!) { node(id: $id) { ... on File {
  focalPoint { x y } renditions { preset size } rendition(preset: THUMB) { size }
} } }`;

// Left half red, right half blue: where a crop lands shows in its pixels.
export function picture(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = "#0000ff";
  context.fillRect(width / 2, 0, width / 2, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

// The helpers bound to one files world.
export function focalKit(files: Files) {
  async function area(
    body: Uint8Array = picture(2000, 1000),
    type = "image/png",
  ) {
    const { workspace, at, owner } = await setup(files.ctx.w);
    const root = await owner.root();
    const send = (query: string, variables: Record<string, unknown>) =>
      files.ctx.w.send(workspace.owner, query, { ...at, variables });
    const record = async (name: string, content = body, mime = type) => {
      const up = await files.upload(
        workspace.owner,
        workspace.id,
        content,
        mime,
      );
      const added = await send(ADD, {
        input: { key: up.key, name, parentId: root.id },
      });
      expect(added.errors).toBeUndefined();
      return field<FileView>(added, "addFile");
    };
    return { workspace, root, owner, send, record };
  }

  async function settled(workspaceId: string, key: string) {
    const db = filesMongo(await store.databaseOf(workspaceId));
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

  return { area, settled, crop };
}
