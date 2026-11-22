import { beforeAll, describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { nodesMongo } from "../models";
import { CREATE, MOVE, RENAME, setup } from "../nodes.harness";

const databaseOf = async (id: string) => nodesMongo(await store.databaseOf(id));

// What every write must leave true: each node's `ancestors` is its parent's plus
// the parent, nothing is its own ancestor, and a parent's name is never
// shared by two live siblings.
async function assertSound(workspaceId: string, accountId: string) {
  const db = await databaseOf(workspaceId);
  const all = await db.db.nodes.findMany({ filter: { ownerId: accountId } });
  const byId = new Map(all.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const node of all) {
    if (node.parentId === null) {
      expect(node.ancestors).toEqual([]);
      continue;
    }
    const parent = byId.get(node.parentId.toHexString());
    expect(parent).toBeDefined();
    expect(node.ancestors.map(String)).toEqual(
      [...(parent?.ancestors ?? []), node.parentId].map(String),
    );
    expect(node.ancestors.map(String)).not.toContain(node.id);
    const key = `${node.parentId}/${node.name.toLowerCase()}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
}

// One workspace for the file (provisioning a workspace database costs about a
// second). Each test, and each round of a test, works under a folder of its
// own, so names and versions never meet across rounds.
let shared: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  shared = await setup();
});

async function arena() {
  const { w, owner, workspace, at } = shared;
  const root = await owner.root();
  const home = await owner.folder(root.id, `arena-${crypto.randomUUID()}`);
  return { w, owner, workspace, at, root: home };
}

describe("concurrent tree writes", () => {
  test("two creates of one name leave one folder and one refusal", async () => {
    const { w, owner, workspace, at, root } = await arena();
    const results = await Promise.all(
      ["Invoices", "invoices"].map((name) =>
        w.send(workspace.owner, CREATE, {
          ...at,
          variables: { parentId: root.id, name },
        }),
      ),
    );
    const refused = results.filter((r) => r.errors);
    expect(results.length - refused.length).toBe(1);
    expect(refused.map((r) => w.codeOf(r))).toEqual([
      "nodes.errors.name-taken",
    ]);
    expect((await owner.names(root.id)).length).toBe(1);
    await assertSound(workspace.id, workspace.owner.principal.accountId);
  });

  test("many creates at once, of one name and of different names", async () => {
    const { w, owner, workspace, at, root } = await arena();
    const same = Array.from({ length: 6 }, () => "Same");
    const different = Array.from({ length: 6 }, (_, i) => `Own ${i}`);
    const results = await Promise.all(
      [...same, ...different].map((name) =>
        w.send(workspace.owner, CREATE, {
          ...at,
          variables: { parentId: root.id, name },
        }),
      ),
    );
    const refused = results.filter((r) => r.errors);
    expect(refused).toHaveLength(5);
    for (const r of refused)
      expect(w.codeOf(r)).toBe("nodes.errors.name-taken");
    expect((await owner.names(root.id)).length).toBe(7);
    await assertSound(workspace.id, workspace.owner.principal.accountId);
  });

  test("a move against a rename to the name the target holds: exactly one wins", async () => {
    for (let round = 0; round < 4; round++) {
      const { w, owner, workspace, at, root } = await arena();
      const folder = await owner.folder(root.id, "draft");
      const target = await owner.folder(root.id, "target");
      await owner.folder(target.id, "final");
      const [renamed, moved] = await Promise.all([
        w.send(workspace.owner, RENAME, {
          ...at,
          variables: { id: folder.id, name: "final", version: folder.version },
        }),
        w.send(workspace.owner, MOVE, {
          ...at,
          variables: { ids: [folder.id], parentId: target.id },
        }),
      ]);
      // The rename alone is fine (the root holds no "final"), and so is the
      // move alone (the target holds no "draft"); together, whichever comes
      // second finds the other's result: a stale version, or a taken name.
      const both = [renamed, moved];
      const lost = both.filter((r) => r.errors);
      expect(lost.length).toBeLessThanOrEqual(1);
      for (const r of lost) {
        expect(["nodes.errors.conflict", "nodes.errors.name-taken"]).toContain(
          w.codeOf(r) ?? "",
        );
      }
      expect(both.some((r) => !r.errors)).toBe(true);
      await assertSound(workspace.id, workspace.owner.principal.accountId);
    }
  });

  test("a rename at the version read before a move is refused as a conflict", async () => {
    const { w, owner, workspace, at, root } = await arena();
    const folder = await owner.folder(root.id, "a");
    const target = await owner.folder(root.id, "t");
    const moved = await w.send(workspace.owner, MOVE, {
      ...at,
      variables: { ids: [folder.id], parentId: target.id },
    });
    expect(moved.errors).toBeUndefined();
    const stale = await w.send(workspace.owner, RENAME, {
      ...at,
      variables: { id: folder.id, name: "b", version: folder.version },
    });
    expect(w.codeOf(stale)).toBe("nodes.errors.conflict");
  });

  test("two moves that would close a cycle: one is refused, the tree stays a tree", async () => {
    for (let round = 0; round < 4; round++) {
      const { w, owner, workspace, at, root } = await arena();
      const a = await owner.folder(root.id, "a");
      const b = await owner.folder(root.id, "b");
      const [one, two] = await Promise.all([
        w.send(workspace.owner, MOVE, {
          ...at,
          variables: { ids: [a.id], parentId: b.id },
        }),
        w.send(workspace.owner, MOVE, {
          ...at,
          variables: { ids: [b.id], parentId: a.id },
        }),
      ]);
      const lost = [one, two].filter((r) => r.errors);
      expect(lost).toHaveLength(1);
      expect(w.codeOf(lost[0] as never)).toBe("nodes.errors.cycle");
      await assertSound(workspace.id, workspace.owner.principal.accountId);
    }
  });

  test("a create under a folder that is being moved keeps its ancestors right", async () => {
    for (let round = 0; round < 4; round++) {
      const { w, owner, workspace, at, root } = await arena();
      const parent = await owner.folder(root.id, "parent");
      const target = await owner.folder(root.id, "target");
      const [made, moved] = await Promise.all([
        w.send(workspace.owner, CREATE, {
          ...at,
          variables: { parentId: parent.id, name: "child" },
        }),
        w.send(workspace.owner, MOVE, {
          ...at,
          variables: { ids: [parent.id], parentId: target.id },
        }),
      ]);
      expect(made.errors).toBeUndefined();
      expect(moved.errors).toBeUndefined();
      await assertSound(workspace.id, workspace.owner.principal.accountId);
    }
  });
});
