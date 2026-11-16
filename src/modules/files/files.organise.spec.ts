import { describe, expect, test } from "bun:test";
import { tryObjectId } from "@softistx/mongo";
import { store } from "@/config/tenancy";
import { areaOf, code, field, objects } from "../../../test/files.area";
import {
  COPY,
  type FileView,
  filesWorld,
  UPDATE,
} from "../../../test/files.harness";
import { MOVE, type NodeView, RENAME } from "../nodes/nodes.harness";
import { filesMongo } from "./files.handle";

const files = filesWorld();

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));
const area = () => areaOf(files);

describe("renameNode on a file", () => {
  test("renames it, keeps its blob, refuses a clash in any case and a stale version", async () => {
    const { root, send, file } = await area();
    const a = await file(root.id, "a.txt");
    await file(root.id, "b.txt");
    const renamed = await send(RENAME, {
      id: a.id,
      name: "c.txt",
      version: a.version,
    });
    expect(renamed.data?.["renameNode"]).toMatchObject({
      name: "c.txt",
      version: a.version + 1,
    });
    const clash = await send(RENAME, {
      id: a.id,
      name: "B.TXT",
      version: a.version + 1,
    });
    expect(code(clash)).toBe("nodes.errors.name-taken");
    const stale = await send(RENAME, {
      id: a.id,
      name: "d.txt",
      version: a.version,
    });
    expect(code(stale)).toBe("nodes.errors.conflict");
  });
});

describe("moveNodes with files", () => {
  test("moves files and folders together", async () => {
    const { root, owner, send, file } = await area();
    const dest = await owner.folder(root.id, "dest");
    const dir = await owner.folder(root.id, "dir");
    const inner = await file(dir.id, "inner.txt");
    const loose = await file(root.id, "loose.txt");
    const moved = await send(MOVE, {
      ids: [loose.id, dir.id, inner.id],
      parentId: dest.id,
    });
    expect(moved.errors).toBeUndefined();
    const nodes = moved.data?.["moveNodes"] as NodeView[];
    expect(nodes.map((n) => n.name).sort()).toEqual(["dir", "loose.txt"]);
    expect(nodes.every((n) => n.parentId === dest.id)).toBe(true);
  });

  test("a failed bulk moves nothing", async () => {
    const { workspace, root, owner, send, file } = await area();
    const dest = await owner.folder(root.id, "dest");
    await file(dest.id, "taken.txt");
    const fine = await file(root.id, "fine.txt");
    const clash = await file(root.id, "Taken.txt");
    const moved = await send(MOVE, {
      ids: [fine.id, clash.id],
      parentId: dest.id,
    });
    expect(code(moved)).toBe("nodes.errors.name-taken");
    const db = await databaseOf(workspace.id);
    for (const f of [fine, clash]) {
      expect((await db.db.nodes.getById(f.id)).parentId?.toHexString()).toBe(
        root.id,
      );
    }
  });

  test("more than 100 nodes are refused before anything runs", async () => {
    const { root, send } = await area();
    const ids = Array.from({ length: 101 }, () => root.id);
    expect((await send(MOVE, { ids, parentId: root.id })).errors).toBeDefined();
    expect((await send(COPY, { ids, parentId: root.id })).errors).toBeDefined();
  });
});

describe("copyNodes", () => {
  test("a copy shares the blob: no object added, refs raised, readable", async () => {
    const { workspace, root, owner, send, file } = await area();
    const original = await file(root.id, "report.txt", "the report");
    const dest = await owner.folder(root.id, "dest");
    const before = await objects(files);
    const copied = await send(COPY, {
      ids: [original.id],
      parentId: root.id,
    });
    expect(copied.errors).toBeUndefined();
    const [same] = field<NodeView[]>(copied, "copyNodes");
    expect(same?.name).toBe("report (1).txt");
    const elsewhere = await send(COPY, {
      ids: [original.id],
      parentId: dest.id,
    });
    const [other] = field<NodeView[]>(elsewhere, "copyNodes");
    expect(other).toMatchObject({ name: "report.txt", parentId: dest.id });
    expect(await objects(files)).toBe(before);
    const db = await databaseOf(workspace.id);
    expect(await db.db.blobs.findFirst({ key: original.key })).toMatchObject({
      refs: 3,
    });
    const doc = await db.db.nodes.getById(same?.id ?? "");
    expect(doc.blobKey).toBe(original.key);
    const read = await files.call(
      workspace.owner,
      workspace.id,
      `/media/files/${original.key}`,
    );
    expect(await read.text()).toBe("the report");
  });

  test("a copy keeps tags and metadata, and is its own node afterwards", async () => {
    const { root, send, file } = await area();
    const original = await file(root.id, "a.txt");
    await send(UPDATE, {
      id: original.id,
      input: { tags: ["x"], meta: { k: 1 } },
    });
    const copied = await send(COPY, { ids: [original.id], parentId: root.id });
    const [copy] = field<NodeView[]>(copied, "copyNodes");
    await send(UPDATE, { id: copy?.id, input: { tags: ["y"] } });
    const again = await send(UPDATE, {
      id: original.id,
      input: { meta: { k: 2 } },
    });
    expect(field<FileView>(again, "updateFile").tags).toEqual(["x"]);
    const probe = await send(UPDATE, { id: copy?.id, input: {} });
    expect(probe.data?.["updateFile"]).toMatchObject({
      tags: ["y"],
      meta: { k: 1 },
    });
  });

  test("copies a folder with what is under it", async () => {
    const { workspace, root, owner, send, file } = await area();
    const dir = await owner.folder(root.id, "dir");
    const sub = await owner.folder(dir.id, "sub");
    const leaf = await file(sub.id, "leaf.txt");
    const top = await file(dir.id, "top.txt");
    const dest = await owner.folder(root.id, "dest");
    const before = await objects(files);
    const copied = await send(COPY, { ids: [dir.id], parentId: dest.id });
    expect(copied.errors).toBeUndefined();
    const [copy] = field<NodeView[]>(copied, "copyNodes");
    expect(copy).toMatchObject({ name: "dir", parentId: dest.id, depth: 3 });
    const copyId = tryObjectId(copy?.id ?? "");
    const db = await databaseOf(workspace.id);
    const below = await db.db.nodes.findMany({
      filter: { ancestors: { $in: copyId ? [copyId] : [] } },
    });
    expect(below.map((n) => n.name).sort()).toEqual([
      "leaf.txt",
      "sub",
      "top.txt",
    ]);
    const copiedLeaf = below.find((n) => n.name === "leaf.txt");
    expect(copiedLeaf?.ancestors.map((a) => a.toHexString())).toEqual([
      root.id,
      dest.id,
      copy?.id ?? "",
      below.find((n) => n.name === "sub")?.id ?? "",
    ]);
    expect(await objects(files)).toBe(before);
    for (const f of [leaf, top]) {
      expect(await db.db.blobs.findFirst({ key: f.key })).toMatchObject({
        refs: 2,
      });
    }
  });

  test("a failed bulk copies nothing and raises no count", async () => {
    const { workspace, root, owner, send, file } = await area();
    const a = await file(root.id, "a.txt");
    const dir = await owner.folder(root.id, "dir");
    const inside = await owner.folder(dir.id, "inside");
    const db = await databaseOf(workspace.id);
    const count = () =>
      db.db.nodes.count({ ownerId: workspace.owner.principal.accountId });
    const nodesBefore = await count();
    const cyclic = await send(COPY, {
      ids: [a.id, dir.id],
      parentId: inside.id,
    });
    expect(code(cyclic)).toBe("nodes.errors.cycle");
    const unknown = await send(COPY, {
      ids: [a.id, "000000000000000000000000"],
      parentId: root.id,
    });
    expect(code(unknown)).toBe("nodes.errors.not-found");
    expect(await count()).toBe(nodesBefore);
    expect(await db.db.blobs.findFirst({ key: a.key })).toMatchObject({
      refs: 1,
    });
  });

  test("a root is never copied, and nobody copies another member's node", async () => {
    const { w, workspace, root, send, file } = await area();
    const other = await w.workspaceOf();
    const mine = await file(root.id, "mine.txt");
    expect(code(await send(COPY, { ids: [root.id], parentId: root.id }))).toBe(
      "nodes.errors.root-locked",
    );
    const stranger = await w.send(other.owner, COPY, {
      workspace: other.id,
      variables: { ids: [mine.id], parentId: root.id },
    });
    expect(code(stranger)).toBe("nodes.errors.not-found");
    expect(workspace.id).not.toBe(other.id);
  });
});
