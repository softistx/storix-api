import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { MOVE, type NodeView, PATH, setup } from "./nodes.harness";
import type { NodesMongo } from "./nodes.service";

const databaseOf = async (id: string) =>
  (await store.databaseOf(id)) as unknown as NodesMongo;

// A world with a tree: root > a > b > c, root > t, root > u.
async function tree() {
  const s = await setup();
  const root = await s.owner.root();
  const a = await s.owner.folder(root.id, "a");
  const b = await s.owner.folder(a.id, "b");
  const c = await s.owner.folder(b.id, "c");
  const t = await s.owner.folder(root.id, "t");
  const u = await s.owner.folder(root.id, "u");
  const move = (ids: string[], parentId: string) =>
    s.w.send(s.workspace.owner, MOVE, {
      ...s.at,
      variables: { ids, parentId },
    });
  const pathOf = async (id: string) => {
    const result = await s.w.send(s.workspace.owner, PATH, {
      ...s.at,
      variables: { id },
    });
    return ((result.data?.["nodePath"] ?? []) as NodeView[]).map((n) => n.name);
  };
  return { ...s, root, a, b, c, t, u, move, pathOf };
}

describe("moveNodes", () => {
  test("moves a folder with its subtree: every descendant's ancestors follow", async () => {
    const { a, b, c, t, move, pathOf } = await tree();
    const moved = await move([a.id], t.id);
    expect(moved.errors).toBeUndefined();
    expect(moved.data?.["moveNodes"]).toMatchObject([
      { name: "a", parentId: t.id, depth: 3 },
    ]);
    expect(await pathOf(c.id)).toEqual(["My files", "t", "a", "b", "c"]);
    expect(await pathOf(b.id)).toEqual(["My files", "t", "a", "b"]);
  });

  test("the descendants carry the new ancestors in the database", async () => {
    const { workspace, root, a, b, c, t, move } = await tree();
    await move([b.id], t.id);
    const db = await databaseOf(workspace.id);
    const doc = await db.db.nodes.getById(c.id);
    expect(doc.ancestors.map((id) => id.toHexString())).toEqual([
      root.id,
      t.id,
      b.id,
    ]);
    const old = await db.db.nodes.getById(a.id);
    expect(old.ancestors.map((id) => id.toHexString())).toEqual([root.id]);
  });

  test("moving into the folder it is already in changes nothing", async () => {
    const { a, root, move } = await tree();
    const moved = await move([a.id], root.id);
    expect(moved.errors).toBeUndefined();
    expect(moved.data?.["moveNodes"][0]).toMatchObject({
      id: a.id,
      version: a.version,
    });
  });

  test("refuses a cycle: into itself, a child or a deeper descendant", async () => {
    const { w, a, b, c, move } = await tree();
    for (const target of [a.id, b.id, c.id]) {
      expect(w.codeOf(await move([a.id], target))).toBe("nodes.errors.cycle");
    }
  });

  test("refuses a name the target already holds, and a bulk that fails moves nothing", async () => {
    const { w, owner, t, u, a, move, pathOf } = await tree();
    await owner.folder(t.id, "u");
    const clash = await move([a.id, u.id], t.id);
    expect(w.codeOf(clash)).toBe("nodes.errors.name-taken");
    expect(await pathOf(a.id)).toEqual(["My files", "a"]);
    expect(await pathOf(u.id)).toEqual(["My files", "u"]);
  });

  test("a node selected with its own parent moves with it, once", async () => {
    const { a, b, c, t, move, pathOf } = await tree();
    const moved = await move([b.id, a.id, b.id], t.id);
    expect(moved.errors).toBeUndefined();
    expect(moved.data?.["moveNodes"].map((n: NodeView) => n.id)).toEqual([
      a.id,
    ]);
    expect(await pathOf(c.id)).toEqual(["My files", "t", "a", "b", "c"]);
  });

  test("a root is never moved, and a target must be one's own folder", async () => {
    const { w, root, a, t, as, workspace, move } = await tree();
    expect(w.codeOf(await move([root.id], t.id))).toBe(
      "nodes.errors.root-locked",
    );
    const member = await w.join(workspace, "MEMBER");
    const theirs = await as(member.user).root();
    expect(w.codeOf(await move([a.id], theirs.id))).toBe(
      "nodes.errors.not-found",
    );
    const asMember = await as(member.user).send(MOVE, {
      ids: [a.id],
      parentId: theirs.id,
    });
    expect(w.codeOf(asMember)).toBe("nodes.errors.not-found");
  });

  test("a parent that is not a folder is refused", async () => {
    const { w, workspace, root, a, move } = await tree();
    const db = await databaseOf(workspace.id);
    const file = await db.db.nodes
      .as(workspace.owner.principal.accountId)
      .create({
        type: "FILE",
        name: "f.txt",
        parentId: root.id,
        ancestors: [root.id],
        ownerId: workspace.owner.principal.accountId,
      });
    expect(w.codeOf(await move([a.id], file.id))).toBe(
      "nodes.errors.not-a-folder",
    );
  });

  test("the subtree's depth counts: a move that would pass 16 levels is refused", async () => {
    const { w, owner, root, a, move, pathOf } = await tree();
    // a > b > c is 3 deep. A chain of 12 under the root leaves room for
    // exactly 13 + 3 = 16 when `a` goes under the 12th...
    let parent = root;
    for (let level = 2; level <= 13; level++) {
      parent = await owner.folder(parent.id, `d${level}`);
    }
    expect(parent.depth).toBe(13);
    // Under the 13th folder the deepest node becomes the 16th: allowed.
    expect((await move([a.id], parent.id)).errors).toBeUndefined();
    expect((await pathOf(a.id)).length).toBe(14);
    const deeper = await owner.folder(parent.id, "one more");
    // A sibling of `a`, one level lower than its parent: the subtree would
    // reach the 17th level.
    expect(w.codeOf(await move([a.id], deeper.id))).toBe(
      "nodes.errors.too-deep",
    );
  });

  test("a subtree of more than 5,000 nodes is refused", async () => {
    const { w, workspace, a, t, move } = await tree();
    const db = await databaseOf(workspace.id);
    const parent = await db.db.nodes.getById(a.id);
    const now = new Date();
    const crowd = Array.from({ length: 5001 }, (_, i) => ({
      type: "FOLDER",
      name: `n${i}`,
      parentId: parent._id,
      ancestors: [...parent.ancestors, parent._id],
      ownerId: workspace.owner.principal.accountId,
      spaceId: null,
      treeRev: 0,
      trashedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
      updatedBy: "seed",
    }));
    await db.db.nodes.raw.insertMany(crowd as never);
    expect(w.codeOf(await move([a.id], t.id))).toBe(
      "nodes.errors.move-too-large",
    );
  });
});
