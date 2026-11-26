import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { filesWorld } from "../../../../test/files.harness";
import { MAX_RECENTS, recordRecent } from "./index";
import {
  area as areaOf,
  code,
  OPEN,
  RECENT,
  type RecentPage,
} from "./personal.harness";

const files = filesWorld();
const area = () => areaOf(files);

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
    ] as RecentPage;
    expect(first.entries.map((e) => e.node.name)).toEqual([
      "three.txt",
      "two.txt",
    ]);
    // Each entry says when the file was opened, latest first.
    const [latest, earlier] = first.entries.map((e) => Date.parse(e.openedAt));
    expect(latest).toBeGreaterThanOrEqual(earlier as number);
    const next = (
      await a.send(a.owner, RECENT, {
        first: 2,
        after: first.pageInfo.endCursor,
      })
    ).data?.["recentFiles"] as RecentPage;
    expect(next.entries.map((e) => e.node.name)).toEqual(["one.txt"]);
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
