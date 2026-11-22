import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { renderImage } from "@softistx/image";
import { store } from "@/config/tenancy";
import {
  ADD,
  type FileView,
  filesWorld,
  png,
} from "../../../test/files.harness";
import { setup } from "../nodes/nodes.harness";
import { filesMongo } from "./models";

const files = filesWorld({ renditions: true });

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

// A drawn picture: the worker decodes it for real.
function picture(width: number, height: number, type: "png" | "jpeg") {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#3355aa";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffcc00";
  context.fillRect(0, 0, width / 2, height / 2);
  return new Uint8Array(
    type === "png"
      ? canvas.toBuffer("image/png")
      : canvas.toBuffer("image/jpeg"),
  );
}

// A one-page PDF with no text: pdf.js draws it as a blank page.
const PDF = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj",
    "trailer<</Root 1 0 R/Size 4>>",
    "%%EOF",
  ].join("\n"),
);

// Records `body` as a file of `type` and answers the node `addFile` returned.
async function record(body: Uint8Array, type: string, name: string) {
  const { workspace, at, owner } = await setup(files.ctx.w);
  const root = await owner.root();
  const up = await files.upload(workspace.owner, workspace.id, body, type);
  const result = await files.ctx.w.send(workspace.owner, ADD, {
    ...at,
    variables: { input: { key: up.key, name, parentId: root.id } },
  });
  expect(result.errors).toBeUndefined();
  return { file: result.data?.["addFile"] as FileView, workspace };
}

// The status the database holds, once it is no longer PROCESSING.
async function settled(workspaceId: string, key: string) {
  const db = await databaseOf(workspaceId);
  for (let i = 0; i < 200; i++) {
    const node = await db.db.nodes.findFirst({ blobKey: key });
    if (node && node.status !== "PROCESSING") return node.status;
    await Bun.sleep(100);
  }
  throw new Error("the renditions did not settle");
}

async function size(
  workspace: { owner: Parameters<typeof files.call>[0]; id: string },
  key: string,
  name: string,
) {
  const res = await files.call(
    workspace.owner,
    workspace.id,
    `/media/files/${key}/${name}`,
  );
  return res;
}

describe("renditions", () => {
  test("a picture is PROCESSING, then READY with both sizes served", async () => {
    const { file, workspace } = await record(
      picture(2000, 1000, "jpeg"),
      "image/jpeg",
      "big.jpg",
    );
    expect(file.status).toBe("PROCESSING");
    expect(await settled(workspace.id, file.key)).toBe("READY");

    const thumb = await size(workspace, file.key, "thumb");
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("cache-control")).toBe("private, no-cache");
    const small = await renderImage(new Uint8Array(await thumb.arrayBuffer()), {
      width: 1,
      height: 1,
      format: "webp",
    });
    expect(small.source).toMatchObject({
      format: "webp",
      width: 320,
      height: 160,
    });

    const preview = await size(workspace, file.key, "preview");
    expect(preview.status).toBe(200);
    const large = await renderImage(
      new Uint8Array(await preview.arrayBuffer()),
      { width: 1, height: 1, format: "webp" },
    );
    expect(large.source).toMatchObject({ width: 1600, height: 800 });
  });

  test("a picture smaller than a size is not enlarged", async () => {
    const { file, workspace } = await record(
      picture(200, 100, "png"),
      "image/png",
      "small.png",
    );
    expect(await settled(workspace.id, file.key)).toBe("READY");
    const preview = await size(workspace, file.key, "preview");
    const made = await renderImage(
      new Uint8Array(await preview.arrayBuffer()),
      {
        width: 1,
        height: 1,
        format: "webp",
      },
    );
    expect(made.source).toMatchObject({ width: 200, height: 100 });
  });

  test("a PDF gets the previews of its first page", async () => {
    const { file, workspace } = await record(PDF, "application/pdf", "doc.pdf");
    expect(file.status).toBe("PROCESSING");
    expect(await settled(workspace.id, file.key)).toBe("READY");
    for (const name of ["thumb", "preview"]) {
      const res = await size(workspace, file.key, name);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
    }
  });

  test("a corrupt picture is FAILED, with no sizes, and still downloadable", async () => {
    const { file, workspace } = await record(png(600), "image/png", "bad.png");
    expect(file.status).toBe("PROCESSING");
    expect(await settled(workspace.id, file.key)).toBe("FAILED");
    expect((await size(workspace, file.key, "thumb")).status).toBe(404);
    const original = await files.call(
      workspace.owner,
      workspace.id,
      `/media/files/${file.key}`,
    );
    expect(original.status).toBe(200);
    expect((await original.arrayBuffer()).byteLength).toBe(600);
  });

  test("a type with no previews stays READY and queues nothing", async () => {
    const { file, workspace } = await record(
      new TextEncoder().encode("hello"),
      "text/plain",
      "a.txt",
    );
    expect(file.status).toBe("READY");
    const db = await databaseOf(workspace.id);
    expect((await db.db.nodes.findFirst({ blobKey: file.key }))?.status).toBe(
      "READY",
    );
    expect((await size(workspace, file.key, "thumb")).status).toBe(404);
  });
});
