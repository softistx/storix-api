import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import {
  NODE_ROLE,
  SHARE,
  sharesArea,
  UNSHARE,
  VERSIONS,
} from "../../../test/shares.harness";

const files = filesWorld();

const PAGE = "nodes { id name } pageInfo { endCursor hasNextPage }";
const WITH_ME = `query($first: Int!, $after: String) { sharedWithMe(first: $first, after: $after) { ${PAGE} } }`;
const BY_ME = `query($first: Int!, $after: String) { sharedByMe(first: $first, after: $after) { ${PAGE} } }`;
const REMOVE = `mutation($memberId: ID!, $transferTo: ID) { removeMember(memberId: $memberId, transferTo: $transferTo) }`;

interface Page {
  nodes: { id: string; name: string }[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

async function area() {
  const a = await sharesArea(files);
  const list = async (
    user: typeof a.workspace.owner,
    query: string,
    variables: Record<string, unknown> = {},
  ) => {
    const r = await a.sendAs(user, query, { first: 50, ...variables });
    if (r.errors) throw new Error(JSON.stringify(r.errors));
    return Object.values(r.data ?? {})[0] as Page;
  };
  const withMe = async (user: typeof a.workspace.owner) =>
    (await list(user, WITH_ME)).nodes.map((n) => n.name);
  const byMe = async (user: typeof a.workspace.owner) =>
    (await list(user, BY_ME)).nodes.map((n) => n.name);
  return { ...a, list, withMe, byMe };
}

describe("sharedWithMe and sharedByMe", () => {
  test("list only the topmost shared node, never a descendant of one", async () => {
    const a = await area();
    const inner = await a.owner.folder(a.folder.id, "Inner");
    await a.share(inner.id, "MEMBER", a.memberIds.viewer, "EDITOR");
    expect(await a.withMe(a.users.viewer)).toEqual(["Shared"]);
    expect(await a.byMe(a.workspace.owner)).toEqual(["Shared"]);
  });

  test("a node shared under an unshared folder is listed on its own", async () => {
    const a = await area();
    const root = await a.owner.root();
    const solo = await a.owner.folder(root.id, "Solo");
    await a.share(solo.id, "MEMBER", a.strangerId, "VIEWER");
    expect(await a.withMe(a.users.stranger)).toEqual(["Solo"]);
    expect((await a.byMe(a.workspace.owner)).toSorted()).toEqual([
      "Shared",
      "Solo",
    ]);
  });

  test("a team grant lists the node for each member of the team", async () => {
    const a = await area();
    expect(await a.withMe(a.users.team)).toEqual(["Shared"]);
    expect(await a.withMe(a.users.stranger)).toEqual([]);
    expect(await a.withMe(a.workspace.owner)).toEqual([]);
  });

  test("a revoked grant leaves the list at once", async () => {
    const a = await area();
    expect(await a.withMe(a.users.viewer)).toEqual(["Shared"]);
    const end = await a.sendAs(a.workspace.owner, UNSHARE, {
      id: a.folder.id,
      grantId: a.grants.viewer.id,
    });
    expect(end.errors).toBeUndefined();
    expect(await a.withMe(a.users.viewer)).toEqual([]);
    expect(await a.withMe(a.users.editor)).toEqual(["Shared"]);
  });

  test("a trashed node is not listed", async () => {
    const a = await area();
    expect((await a.trash(a.workspace.owner, a.folder.id)).errors).toBe(
      undefined,
    );
    expect(await a.withMe(a.users.viewer)).toEqual([]);
    expect(await a.byMe(a.workspace.owner)).toEqual([]);
  });

  test("pages by cursor and refuses a cursor of the other list", async () => {
    const a = await area();
    const root = await a.owner.root();
    for (const name of ["Alpha", "Beta"]) {
      const f = await a.owner.folder(root.id, name);
      await a.share(f.id, "MEMBER", a.memberIds.viewer, "VIEWER");
    }
    const one = await a.list(a.users.viewer, WITH_ME, { first: 2 });
    expect(one.nodes.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
    expect(one.pageInfo.hasNextPage).toBe(true);
    const two = await a.list(a.users.viewer, WITH_ME, {
      first: 2,
      after: one.pageInfo.endCursor,
    });
    expect(two.nodes.map((n) => n.name)).toEqual(["Shared"]);
    expect(two.pageInfo.hasNextPage).toBe(false);
    const wrong = await a.sendAs(a.users.viewer, BY_ME, {
      first: 2,
      after: one.pageInfo.endCursor,
    });
    expect(a.w.codeOf(wrong)).toBe("validation.errors.invalid-cursor");
  });
});

describe("sharedByMe, for a grant made by an editor", () => {
  test("is the editor's own list, and not the owner's", async () => {
    const a = await area();
    const again = await a.sendAs(a.users.editor, SHARE, {
      id: a.file.id,
      principal: { type: "MEMBER", id: a.strangerId },
      role: "VIEWER",
    });
    expect(again.errors).toBeUndefined();
    expect(await a.byMe(a.users.editor)).toEqual(["doc.txt"]);
    expect(await a.byMe(a.workspace.owner)).toEqual(["Shared"]);
    expect(await a.withMe(a.users.stranger)).toEqual(["doc.txt"]);
  });
});

describe("removing a member", () => {
  test("transfers their tree with every blob and ends the grants they hold and gave", async () => {
    const a = await area();
    const leaver = await a.w.join(a.workspace, "MEMBER");
    const receiver = await a.w.join(a.workspace, "ADMIN");
    const root = await a.as(leaver.user).root();
    const mine = await a.as(leaver.user).folder(root.id, "Mine");
    const file = await files.addFile(
      leaver.user,
      a.workspace.id,
      mine.id,
      "keep.txt",
      "keep",
    );
    const given = await a.sendAs(leaver.user, SHARE, {
      id: mine.id,
      principal: { type: "MEMBER", id: a.memberIds.viewer },
      role: "VIEWER",
    });
    expect(given.errors).toBeUndefined();
    await a.share(a.folder.id, "MEMBER", leaver.memberId, "VIEWER");
    expect(await a.withMe(a.users.viewer)).toContain("Mine");
    const before = await a.sendAs(leaver.user, VERSIONS, { id: file.id });

    const removed = await a.sendAs(a.workspace.owner, REMOVE, {
      memberId: leaver.memberId,
      transferTo: receiver.memberId,
    });
    expect(removed.errors).toBeUndefined();

    expect((await a.media(receiver.user, file.key)).status).toBe(200);
    const after = await a.sendAs(receiver.user, VERSIONS, { id: file.id });
    expect(after.data?.["node"].versions).toEqual(
      before.data?.["node"].versions,
    );
    expect(await a.withMe(a.users.viewer)).not.toContain("Mine");
    expect(await a.byMe(receiver.user)).not.toContain("Mine");
    const mineAfter = await a.sendAs(receiver.user, NODE_ROLE, { id: mine.id });
    expect(mineAfter.data?.["node"].grants).toEqual([]);
    const folder = await a.sendAs(a.workspace.owner, NODE_ROLE, {
      id: a.folder.id,
    });
    expect(folder.data?.["node"].grants).toHaveLength(3);
  });

  test("a grant someone else made on another account's node survives", async () => {
    const a = await area();
    const leaver = await a.w.join(a.workspace, "MEMBER");
    const receiver = await a.w.join(a.workspace, "ADMIN");
    const removed = await a.sendAs(a.workspace.owner, REMOVE, {
      memberId: leaver.memberId,
      transferTo: receiver.memberId,
    });
    expect(removed.errors).toBeUndefined();
    const kept = await a.sendAs(a.workspace.owner, NODE_ROLE, {
      id: a.folder.id,
    });
    expect(kept.data?.["node"].grants).toHaveLength(3);
    expect(await a.byMe(a.workspace.owner)).toEqual(["Shared"]);
  });
});
