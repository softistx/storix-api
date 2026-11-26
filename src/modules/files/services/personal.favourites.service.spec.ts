import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import {
  area as areaOf,
  code,
  OPEN,
  type Page,
  RECENT,
  STAR,
  STARRED,
} from "./personal.harness";

const files = filesWorld();
const area = () => areaOf(files);

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
