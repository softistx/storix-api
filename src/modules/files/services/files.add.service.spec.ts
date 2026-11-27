import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import {
  ADD,
  type FileView,
  fileOf,
  filesWorld,
} from "../../../../test/files.harness";
import { setup } from "../../../../test/nodes.harness";
import { filesMongo } from "../models";

const files = filesWorld();

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

// The world of the nodes specs, over the files' storage.
async function area() {
  const s = await setup(files.ctx.w);
  return s;
}

describe("addFile", () => {
  test("records an upload as a file with the storage's type and size, and a blob", async () => {
    const { workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(workspace.owner, workspace.id, "hello world");
    const result = await files.ctx.w.send(workspace.owner, ADD, {
      ...at,
      variables: {
        input: { key: up.key, name: "  hello.txt  ", parentId: root.id },
      },
    });
    expect(result.errors).toBeUndefined();
    const file = result.data?.["addFile"] as FileView;
    expect(file).toMatchObject({
      type: "FILE",
      name: "hello.txt",
      parentId: root.id,
      key: up.key,
      mimeType: "text/plain",
      size: 11,
      family: "DOCUMENT",
      tags: [],
      status: "READY",
    });
    const db = await databaseOf(workspace.id);
    const blob = await db.db.blobs.findFirst({ key: up.key });
    expect(blob).toMatchObject({ size: 11, mimeType: "text/plain", refs: 2 });
    const node = await db.db.nodes.findFirst({ blobKey: up.key });
    expect(node).toMatchObject({ type: "FILE", size: 11 });
  });

  test("the input never says the type or the size: a lie in the name changes nothing", async () => {
    const { workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(
      workspace.owner,
      workspace.id,
      "x".repeat(40),
      "application/x-custom",
    );
    const result = await files.ctx.w.send(workspace.owner, ADD, {
      ...at,
      variables: { input: { key: up.key, name: "a.png", parentId: root.id } },
    });
    expect(result.data?.["addFile"]).toMatchObject({
      size: 40,
      mimeType: "application/x-custom",
      family: "OTHER",
    });
  });

  test("REFUSE (the default) is name-taken in any case; KEEP_BOTH numbers the copy", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const add = async (name: string, onConflict?: string) => {
      const up = await files.upload(workspace.owner, workspace.id, name);
      return w.send(workspace.owner, ADD, {
        ...at,
        variables: {
          input: {
            key: up.key,
            name,
            parentId: root.id,
            ...(onConflict && { onConflict }),
          },
        },
      });
    };
    expect((await add("report.pdf")).errors).toBeUndefined();
    const refused = await add("REPORT.pdf");
    expect(refused.errors?.[0]?.extensions?.code).toBe(
      "nodes.errors.name-taken",
    );
    const one = await add("report.pdf", "KEEP_BOTH");
    expect(fileOf(one).name).toBe("report (1).pdf");
    const two = await add("Report.pdf", "KEEP_BOTH");
    expect(fileOf(two).name).toBe("Report (2).pdf");
    const bare = await add("notes", "KEEP_BOTH");
    expect(fileOf(bare).name).toBe("notes");
    const bare2 = await add("notes", "KEEP_BOTH");
    expect(fileOf(bare2).name).toBe("notes (1)");
    // A folder holds a name too.
    await owner.folder(root.id, "photos");
    const clash = await add("photos", "KEEP_BOTH");
    expect(fileOf(clash).name).toBe("photos (1)");
    // A refused add leaves no node and no blob behind.
    const db = await databaseOf(workspace.id);
    const nodes = await db.db.nodes.findMany({
      filter: { type: "FILE", ownerId: workspace.owner.principal.accountId },
    });
    expect(await db.db.blobs.count()).toBe(nodes.length);
  });
});
