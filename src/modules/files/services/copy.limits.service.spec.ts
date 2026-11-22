import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { workspacesMongo } from "@/core/workspaces";
import { areaOf, code } from "../../../../test/files.area";
import { filesWorld } from "../../../../test/files.harness";
import { filesMongo } from "../models";
import { copyNodes } from "./index";

const files = filesWorld();

// `copyNodes` with the caps lowered, so a limit is reached with a few nodes.
async function copy(
  a: Awaited<ReturnType<typeof areaOf>>,
  ids: string[],
  parentId: string,
  limits: { maxNodes: number; maxDepth: number },
) {
  const mongo = filesMongo(await store.databaseOf(a.workspace.id));
  const core = workspacesMongo(store.core);
  return copyNodes(
    mongo,
    core,
    {
      ids,
      parentId,
      accountId: a.workspace.owner.principal.accountId,
      workspaceId: a.workspace.id,
    },
    limits,
  ).then(
    () => undefined,
    (error: { extensions?: { code?: string } }) => ({
      errors: [{ extensions: error.extensions }],
    }),
  );
}

describe("copyNodes limits", () => {
  test("a tree over the node cap is refused and nothing is copied", async () => {
    const a = await areaOf(files);
    const dir = await a.owner.folder(a.root.id, "dir");
    await a.file(dir.id, "1.txt");
    await a.file(dir.id, "2.txt");
    await a.file(dir.id, "3.txt");
    const dest = await a.owner.folder(a.root.id, "dest");
    const db = filesMongo(await store.databaseOf(a.workspace.id));
    const before = await db.db.nodes.count({});
    // The folder and its three files are four nodes: a cap of three refuses.
    const refused = await copy(a, [dir.id], dest.id, {
      maxNodes: 3,
      maxDepth: 16,
    });
    expect(code(refused ?? {})).toBe("files.errors.copy-too-large");
    expect(await db.db.nodes.count({})).toBe(before);
    // A cap of four takes it.
    expect(
      await copy(a, [dir.id], dest.id, { maxNodes: 4, maxDepth: 16 }),
    ).toBeUndefined();
    expect(await db.db.nodes.count({})).toBe(before + 4);
  });

  test("a copy that would go past the depth cap is refused", async () => {
    const a = await areaOf(files);
    const dir = await a.owner.folder(a.root.id, "dir");
    await a.owner.folder(dir.id, "sub");
    const dest = await a.owner.folder(a.root.id, "dest");
    // dir (2) and sub (3) under dest (2) reach depth 4.
    const refused = await copy(a, [dir.id], dest.id, {
      maxNodes: 100,
      maxDepth: 3,
    });
    expect(code(refused ?? {})).toBe("nodes.errors.too-deep");
    expect(
      await copy(a, [dir.id], dest.id, { maxNodes: 100, maxDepth: 4 }),
    ).toBeUndefined();
  });

  test("a folder is never copied into itself or below itself", async () => {
    const a = await areaOf(files);
    const dir = await a.owner.folder(a.root.id, "dir");
    const sub = await a.owner.folder(dir.id, "sub");
    const limits = { maxNodes: 100, maxDepth: 16 };
    for (const into of [dir.id, sub.id]) {
      expect(code((await copy(a, [dir.id], into, limits)) ?? {})).toBe(
        "nodes.errors.cycle",
      );
    }
  });
});
