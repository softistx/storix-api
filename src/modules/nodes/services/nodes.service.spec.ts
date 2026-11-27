import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import {
  CREATE,
  FOLDERS,
  type NodeView,
  PATH,
  RENAME,
  ROOTS,
  setup,
} from "../../../../test/nodes.harness";
import { nodesMongo } from "../models";

const databaseOf = async (id: string) => nodesMongo(await store.databaseOf(id));

describe("the member's root", () => {
  test("is made when the workspace is created and when a member joins, before any read", async () => {
    const { w, workspace } = await setup();
    const db = await databaseOf(workspace.id);
    const ownerRoot = await db.db.nodes.findFirst({
      ownerId: workspace.owner.principal.accountId,
    });
    expect(ownerRoot).toMatchObject({ name: "My files", parentId: null });
    const member = await w.join(workspace, "MEMBER");
    const root = await db.db.nodes.findFirst({
      ownerId: member.user.principal.accountId,
    });
    expect(root).toMatchObject({
      type: "FOLDER",
      name: "My files",
      parentId: null,
      ancestors: [],
    });
  });

  test("is one per member, read by `roots`, and private", async () => {
    const { w, workspace, at, as } = await setup();
    const member = await w.join(workspace, "MEMBER");
    const admin = await w.join(workspace, "ADMIN");
    const mine = await as(member.user).root();
    const first = await as(workspace.owner).root();
    expect(mine).toMatchObject({
      name: "My files",
      parentId: null,
      depth: 1,
      ancestors: [],
    });
    expect(mine.id).not.toBe(first.id);
    const again = await as(member.user).root();
    expect(again.id).toBe(mine.id);
    const page = await w.send(member.user, ROOTS, at);
    expect(page.data?.["roots"]).toHaveLength(1);
    // Nobody sees another's root, an owner and an admin included.
    for (const other of [workspace.owner, admin.user]) {
      const read = await w.send(other, PATH, {
        ...at,
        variables: { id: mine.id },
      });
      expect(w.codeOf(read)).toBe("nodes.errors.not-found");
    }
  });

  test("is made on first read for a member who joined without one", async () => {
    const { w, workspace, at } = await setup();
    const db = await databaseOf(workspace.id);
    const member = await w.join(workspace, "MEMBER");
    await db.db.nodes.deleteMany({
      ownerId: member.user.principal.accountId,
    });
    const roots = await w.send(member.user, ROOTS, at);
    expect(roots.data?.["roots"]).toHaveLength(1);
  });

  test("two readers at once leave one root", async () => {
    const { w, workspace, at } = await setup();
    const db = await databaseOf(workspace.id);
    const member = await w.join(workspace, "MEMBER");
    const accountId = member.user.principal.accountId;
    await db.db.nodes.deleteMany({ ownerId: accountId });
    const reads = await Promise.all(
      [1, 2, 3, 4].map(() => w.send(member.user, ROOTS, at)),
    );
    for (const read of reads) expect(read.errors).toBeUndefined();
    expect(await db.db.nodes.count({ ownerId: accountId })).toBe(1);
  });
});

describe("createFolder, folders, nodePath", () => {
  test("a folder is made under the root and under a folder, listed by name and found by its path", async () => {
    const { w, owner, workspace, at } = await setup();
    const root = await owner.root();
    const zeta = await owner.folder(root.id, "Zeta");
    const alpha = await owner.folder(root.id, "alpha");
    const inner = await owner.folder(alpha.id, "Reports");
    expect(inner).toMatchObject({
      type: "FOLDER",
      name: "Reports",
      parentId: alpha.id,
      ancestors: [root.id, alpha.id],
      depth: 3,
      version: 0,
    });
    expect(await owner.names(root.id)).toEqual(["alpha", "Zeta"]);
    expect(zeta.depth).toBe(2);
    const noParent = await w.send(workspace.owner, FOLDERS, at);
    expect(noParent.data?.["folders"].map((n: NodeView) => n.id)).toEqual([
      root.id,
    ]);
    const path = await w.send(workspace.owner, PATH, {
      ...at,
      variables: { id: inner.id },
    });
    expect(path.data?.["nodePath"].map((n: NodeView) => n.name)).toEqual([
      "My files",
      "alpha",
      "Reports",
    ]);
  });

  test("a name is trimmed and may not be blank, hold a slash or a control character, or be a dot name", async () => {
    const { w, owner, workspace, at } = await setup();
    const root = await owner.root();
    const trimmed = await owner.folder(root.id, "  Spaced  ");
    expect(trimmed.name).toBe("Spaced");
    for (const name of ["   ", "a/b", "a\\b", "..", ".", "a\u0007b"]) {
      const result = await w.send(workspace.owner, CREATE, {
        ...at,
        variables: { parentId: root.id, name },
      });
      expect(w.codeOf(result)).toBe("validation.errors.invalid-input");
    }
  });

  test("a name is unique among siblings ignoring case, and free under another parent", async () => {
    const { w, owner, workspace, at } = await setup();
    const root = await owner.root();
    const photos = await owner.folder(root.id, "Photos");
    const clash = await w.send(workspace.owner, CREATE, {
      ...at,
      variables: { parentId: root.id, name: "photos" },
    });
    expect(w.codeOf(clash)).toBe("nodes.errors.name-taken");
    expect(clash.errors?.[0]).toMatchObject({
      extensions: { field: "name" },
    });
    const other = await owner.folder(photos.id, "photos");
    expect(other.parentId).toBe(photos.id);
  });

  test("another member's folder, an unknown id and a malformed one are not found", async () => {
    const { w, owner, workspace, as } = await setup();
    const root = await owner.root();
    const member = await w.join(workspace, "MEMBER");
    const theirs = as(member.user);
    for (const id of [root.id, "507f1f77bcf86cd799439011", "nope"]) {
      const result = await theirs.send(CREATE, { parentId: id, name: "x" });
      expect(w.codeOf(result)).toBe("nodes.errors.not-found");
      const list = await theirs.send(FOLDERS, { parentId: id });
      expect(w.codeOf(list)).toBe("nodes.errors.not-found");
    }
  });

  test("a workspace's folder is not reachable from another workspace", async () => {
    const { owner, w } = await setup();
    const root = await owner.root();
    const other = await w.workspaceOf();
    const result = await w.send(other.owner, CREATE, {
      workspace: other.id,
      variables: { parentId: root.id, name: "x" },
    });
    expect(w.codeOf(result)).toBe("nodes.errors.not-found");
  });

  test("an anonymous caller is refused and a workspace is required", async () => {
    const { w, workspace } = await setup();
    const anon = await w.send(null, ROOTS, { workspace: workspace.id });
    expect(w.codeOf(anon)).toBe("auth.errors.unauthenticated");
    const none = await w.send(workspace.owner, ROOTS);
    expect(w.codeOf(none)).toBe("workspaces.errors.workspace-required");
  });

  test("the 16th level is the last", async () => {
    const { w, owner, workspace, at } = await setup();
    let parent = await owner.root();
    for (let level = 2; level <= 16; level++) {
      parent = await owner.folder(parent.id, `level ${level}`);
    }
    expect(parent.depth).toBe(16);
    const deeper = await w.send(workspace.owner, CREATE, {
      ...at,
      variables: { parentId: parent.id, name: "level 17" },
    });
    expect(w.codeOf(deeper)).toBe("nodes.errors.too-deep");
  });
});

describe("renameNode", () => {
  test("renames a folder at its version, raising it, and allows a change of case", async () => {
    const { w, owner, workspace, at } = await setup();
    const root = await owner.root();
    const folder = await owner.folder(root.id, "docs");
    const renamed = await w.send(workspace.owner, RENAME, {
      ...at,
      variables: { id: folder.id, name: "Docs", version: folder.version },
    });
    expect(renamed.errors).toBeUndefined();
    expect(renamed.data?.["renameNode"]).toMatchObject({
      name: "Docs",
      version: folder.version + 1,
    });
  });

  test("refuses a stale version, a sibling's name, a root and another member's node", async () => {
    const { w, owner, workspace, at, as } = await setup();
    const root = await owner.root();
    const a = await owner.folder(root.id, "a");
    await owner.folder(root.id, "b");
    const send = (id: string, name: string, version: number) =>
      w.send(workspace.owner, RENAME, {
        ...at,
        variables: { id, name, version },
      });
    expect(w.codeOf(await send(a.id, "c", a.version + 5))).toBe(
      "nodes.errors.conflict",
    );
    expect(w.codeOf(await send(a.id, "B", a.version))).toBe(
      "nodes.errors.name-taken",
    );
    expect(w.codeOf(await send(root.id, "Home", root.version))).toBe(
      "nodes.errors.root-locked",
    );
    const member = await w.join(workspace, "MEMBER");
    const theirs = await as(member.user).send(RENAME, {
      id: a.id,
      name: "z",
      version: a.version,
    });
    expect(w.codeOf(theirs)).toBe("nodes.errors.not-found");
  });
});
