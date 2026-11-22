import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { store } from "@/config/tenancy";
import { filesWorld } from "../../../test/files.harness";
import { NODE, setup } from "../nodes/nodes.harness";
import { filesMongo } from "./models";
import { MAX_RECENTS, recordRecent } from "./services";

const files = filesWorld();

const STAR = `mutation($id: ID!, $starred: Boolean!) { setStarred(id: $id, starred: $starred) { ${NODE} } }`;
const OPEN = `mutation($id: ID!) { openFile(id: $id) { ${NODE} } }`;
const STARRED = `query($first: Int, $after: String) { starred(first: $first, after: $after) { nodes { ${NODE} } pageInfo { endCursor hasNextPage } } }`;
const RECENT = `query($first: Int, $after: String) { recentFiles(first: $first, after: $after) { nodes { ${NODE} } pageInfo { endCursor hasNextPage } } }`;

interface Page {
  nodes: { id: string; name: string }[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

async function area() {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const { owner, id } = s.workspace;
  const db = filesMongo(await store.databaseOf(id));
  const file = (name: string, who = owner, parentId = root.id) =>
    files.addFile(who, id, parentId, name);
  const send = (
    user: typeof owner,
    query: string,
    vars: Record<string, unknown> = {},
  ) => s.w.send(user, query, { ...s.at, variables: vars });
  const names = async (
    user: typeof owner,
    query: string,
    key: "starred" | "recentFiles",
    vars: Record<string, unknown> = {},
  ) => {
    const r = await send(user, query, vars);
    return ((r.data?.[key] as Page | undefined)?.nodes ?? []).map(
      (n) => n.name,
    );
  };
  const trash = (nodeId: string, at: Date | null) =>
    db.db.nodes.updateMany({ _id: nodeId as never }, { trashedAt: at });
  return { ...s, root, db, file, send, names, owner, trash };
}

const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;

describe("favourites", () => {
  test("stars and unstars, newest first, idempotently", async () => {
    const a = await area();
    const x = await a.file("x.txt");
    const y = await a.file("y.txt");
    for (const n of [x, y]) {
      const r = await a.send(a.owner, STAR, { id: n.id, starred: true });
      expect(r.data?.["setStarred"]).toMatchObject({ id: n.id });
    }
    await a.send(a.owner, STAR, { id: x.id, starred: true });
    expect(await a.names(a.owner, STARRED, "starred")).toEqual([
      "y.txt",
      "x.txt",
    ]);
    await a.send(a.owner, STAR, { id: y.id, starred: false });
    await a.send(a.owner, STAR, { id: y.id, starred: false });
    expect(await a.names(a.owner, STARRED, "starred")).toEqual(["x.txt"]);
  });

  test("a folder can be starred; pages follow the cursor", async () => {
    const a = await area();
    const dir = await a.as(a.workspace.owner).folder(a.root.id, "docs");
    const made = [dir, await a.file("a.txt"), await a.file("b.txt")];
    for (const n of made) {
      await a.send(a.owner, STAR, { id: n.id, starred: true });
    }
    const one = (await a.send(a.owner, STARRED, { first: 2 })).data?.[
      "starred"
    ] as Page;
    expect(one.nodes.map((n) => n.name)).toEqual(["b.txt", "a.txt"]);
    expect(one.pageInfo.hasNextPage).toBe(true);
    const two = (
      await a.send(a.owner, STARRED, {
        first: 2,
        after: one.pageInfo.endCursor,
      })
    ).data?.["starred"] as Page;
    expect(two.nodes.map((n) => n.name)).toEqual(["docs"]);
    expect(two.pageInfo.endCursor).toBeNull();
  });

  test("each account has its own list, and another's node is a 404", async () => {
    const a = await area();
    const member = await a.w.join(a.workspace, "MEMBER");
    const mine = await a.file("mine.txt");
    const mroot = await a.as(member.user).root();
    const theirs = await a.file("theirs.txt", member.user, mroot.id);
    await a.send(a.owner, STAR, { id: mine.id, starred: true });
    const refused = await a.send(member.user, STAR, {
      id: mine.id,
      starred: true,
    });
    expect(code(refused)).toBe("nodes.errors.not-found");
    await a.send(member.user, STAR, { id: theirs.id, starred: true });
    expect(await a.names(a.owner, STARRED, "starred")).toEqual(["mine.txt"]);
    expect(await a.names(member.user, STARRED, "starred")).toEqual([
      "theirs.txt",
    ]);
    // Unstarring another's node neither works nor touches their star.
    const other = await a.send(member.user, STAR, {
      id: mine.id,
      starred: false,
    });
    expect(code(other)).toBe("nodes.errors.not-found");
    expect(await a.names(a.owner, STARRED, "starred")).toEqual(["mine.txt"]);
  });

  test("a trashed node leaves the list, a restore brings it back", async () => {
    const a = await area();
    const nodes = [];
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      const n = await a.file(name);
      nodes.push(n);
      await a.send(a.owner, STAR, { id: n.id, starred: true });
    }
    const [, b] = nodes;
    if (!b) throw new Error("no node");
    await a.trash(b.id, new Date());
    // The page of 2 is still full: the trashed row is skipped, not counted.
    const page = (await a.send(a.owner, STARRED, { first: 2 })).data?.[
      "starred"
    ] as Page;
    expect(page.nodes.map((n) => n.name)).toEqual(["c.txt", "a.txt"]);
    expect(page.pageInfo.hasNextPage).toBe(false);
    const refused = await a.send(a.owner, STAR, { id: b.id, starred: true });
    expect(code(refused)).toBe("nodes.errors.not-found");
    await a.trash(b.id, null);
    expect(await a.names(a.owner, STARRED, "starred")).toEqual([
      "c.txt",
      "b.txt",
      "a.txt",
    ]);
  });

  test("a cursor of another list or a forged one is refused", async () => {
    const a = await area();
    const x = await a.file("x.txt");
    const y = await a.file("y.txt");
    for (const n of [x, y]) {
      await a.send(a.owner, STAR, { id: n.id, starred: true });
      await a.send(a.owner, OPEN, { id: n.id });
    }
    const starred = (await a.send(a.owner, STARRED, { first: 1 })).data?.[
      "starred"
    ] as Page;
    const cursor = starred.pageInfo.endCursor;
    const wrong = await a.send(a.owner, RECENT, { first: 1, after: cursor });
    expect(code(wrong)).toBe("validation.errors.invalid-cursor");
    const parsed = JSON.parse(
      Buffer.from(cursor ?? "", "base64url").toString(),
    );
    parsed.v[0] = { $ne: null };
    const forged = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    const refused = await a.send(a.owner, STARRED, { after: forged });
    expect(code(refused)).toBe("validation.errors.invalid-cursor");
  });
});

describe("recent files", () => {
  test("an upload and an open are recorded, once per file, latest first", async () => {
    const a = await area();
    const x = await a.file("x.txt");
    await a.file("y.txt");
    expect(await a.names(a.owner, RECENT, "recentFiles")).toEqual([
      "y.txt",
      "x.txt",
    ]);
    const opened = await a.send(a.owner, OPEN, { id: x.id });
    expect(opened.data?.["openFile"]).toMatchObject({ id: x.id });
    await a.send(a.owner, OPEN, { id: x.id });
    expect(await a.names(a.owner, RECENT, "recentFiles")).toEqual([
      "x.txt",
      "y.txt",
    ]);
    expect(await a.db.db.recents.count({})).toBe(2);
  });

  test("a folder is not opened, another's file is a 404, pages follow the cursor", async () => {
    const a = await area();
    const member = await a.w.join(a.workspace, "MEMBER");
    const dir = await a.as(a.workspace.owner).folder(a.root.id, "docs");
    const one = await a.file("one.txt");
    await a.file("two.txt");
    await a.file("three.txt");
    const folder = await a.send(a.owner, OPEN, { id: dir.id });
    expect(code(folder)).toBe("files.errors.not-a-file");
    const foreign = await a.send(member.user, OPEN, { id: one.id });
    expect(code(foreign)).toBe("nodes.errors.not-found");
    expect(await a.names(member.user, RECENT, "recentFiles")).toEqual([]);
    const first = (await a.send(a.owner, RECENT, { first: 2 })).data?.[
      "recentFiles"
    ] as Page;
    expect(first.nodes.map((n) => n.name)).toEqual(["three.txt", "two.txt"]);
    const next = (
      await a.send(a.owner, RECENT, {
        first: 2,
        after: first.pageInfo.endCursor,
      })
    ).data?.["recentFiles"] as Page;
    expect(next.nodes.map((n) => n.name)).toEqual(["one.txt"]);
    expect(next.pageInfo.hasNextPage).toBe(false);
  });

  test("a trashed file leaves the list and cannot be opened", async () => {
    const a = await area();
    const x = await a.file("x.txt");
    await a.file("y.txt");
    await a.trash(x.id, new Date());
    expect(await a.names(a.owner, RECENT, "recentFiles")).toEqual(["y.txt"]);
    const refused = await a.send(a.owner, OPEN, { id: x.id });
    expect(code(refused)).toBe("nodes.errors.not-found");
    await a.trash(x.id, null);
    expect(await a.names(a.owner, RECENT, "recentFiles")).toEqual([
      "y.txt",
      "x.txt",
    ]);
  });

  test("an account keeps at most 200, the oldest go", async () => {
    const a = await area();
    await a.file("x.txt");
    const accountId = a.owner.principal.accountId;
    const rows = Array.from({ length: MAX_RECENTS + 5 }, (_, i) => ({
      accountId,
      nodeId: new ObjectId(),
      at: new Date(1_000 + i),
    }));
    await a.db.db.recents.createMany(rows);
    await recordRecent(a.db, { accountId, nodeId: new ObjectId() });
    expect(await a.db.db.recents.count({ accountId })).toBe(MAX_RECENTS);
    const oldest = await a.db.db.recents.findFirst({
      accountId,
      at: new Date(1_000),
    });
    expect(oldest).toBeUndefined();
    // Another account's rows are not counted.
    expect(await a.db.db.recents.count({ accountId: "someone-else" })).toBe(0);
  });
});
