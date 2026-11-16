import { describe, expect, test } from "bun:test";
import { areaOf, code, field } from "../../../test/files.area";
import { type FileView, filesWorld, UPDATE } from "../../../test/files.harness";

const files = filesWorld();
const area = () => areaOf(files);

describe("updateFile", () => {
  test("tags are trimmed, lower case and unique; meta replaces; a field left out stays", async () => {
    const { root, send, file } = await area();
    const f = await file(root.id, "a.txt");
    const first = await send(UPDATE, {
      id: f.id,
      input: { tags: [" Invoice ", "invoice", "2026", ""], meta: { a: 1 } },
    });
    expect(first.errors).toBeUndefined();
    expect(first.data?.["updateFile"]).toMatchObject({
      tags: ["invoice", "2026"],
      meta: { a: 1 },
      version: f.version + 1,
    });
    const second = await send(UPDATE, {
      id: f.id,
      input: { meta: { b: { c: [1] } } },
    });
    expect(second.data?.["updateFile"]).toMatchObject({
      tags: ["invoice", "2026"],
      meta: { b: { c: [1] } },
    });
    const cleared = await send(UPDATE, { id: f.id, input: { tags: [] } });
    expect(field<FileView>(cleared, "updateFile").tags).toEqual([]);
  });

  test("a version that moved on is a conflict; the current one holds", async () => {
    const { root, send, file } = await area();
    const f = await file(root.id, "a.txt");
    const ok = await send(UPDATE, {
      id: f.id,
      input: { tags: ["a"], version: f.version },
    });
    expect(ok.errors).toBeUndefined();
    const stale = await send(UPDATE, {
      id: f.id,
      input: { tags: ["b"], version: f.version },
    });
    expect(code(stale)).toBe("nodes.errors.conflict");
  });

  test("a folder is not-a-file; bad tags and metadata are field issues", async () => {
    const { root, owner, send, file } = await area();
    const dir = await owner.folder(root.id, "dir");
    expect(
      code(await send(UPDATE, { id: dir.id, input: { tags: ["a"] } })),
    ).toBe("files.errors.not-a-file");
    const f = await file(root.id, "a.txt");
    const long = await send(UPDATE, {
      id: f.id,
      input: { tags: ["x".repeat(51)] },
    });
    expect(code(long)).toBe("validation.errors.invalid-input");
    const many = await send(UPDATE, {
      id: f.id,
      input: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    });
    expect(many.errors).toBeDefined();
    const big = await send(UPDATE, {
      id: f.id,
      input: { meta: { text: "x".repeat(20_000) } },
    });
    expect(code(big)).toBe("validation.errors.invalid-input");
    const kept = await send(UPDATE, { id: f.id, input: {} });
    expect(kept.data?.["updateFile"]).toMatchObject({ tags: [], meta: {} });
  });

  test("a node of another workspace is not found", async () => {
    const { w, root, file } = await area();
    const other = await w.workspaceOf();
    const f = await file(root.id, "a.txt");
    const result = await w.send(other.owner, UPDATE, {
      workspace: other.id,
      variables: { id: f.id, input: { tags: ["a"] } },
    });
    expect(code(result)).toBe("nodes.errors.not-found");
  });
});
