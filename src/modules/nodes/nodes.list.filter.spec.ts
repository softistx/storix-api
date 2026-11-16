import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { listKit } from "../../../test/nodes.list.harness";

const files = filesWorld();
const { fixture, list, names } = listKit(files);

describe("nodes filters and paging", () => {
  test("filters by family, tags and name", async () => {
    const f = await fixture();
    expect(names(await list(f, { filter: { families: ["IMAGE"] } }))).toEqual([
      "A.png",
      "d.png",
    ]);
    expect(
      names(await list(f, { filter: { families: ["PDF", "DOCUMENT"] } })),
    ).toEqual(["b.txt", "c.pdf"]);
    expect(names(await list(f, { filter: { name: "PNG" } }))).toEqual([
      "A.png",
      "d.png",
    ]);
    expect(names(await list(f, { filter: { name: "." } }))).toEqual([
      "A.png",
      "b.txt",
      "c.pdf",
      "d.png",
    ]);
    expect(names(await list(f, { filter: { name: "zzz" } }))).toEqual([]);
  });

  test("filters by tags (all of them)", async () => {
    const f = await fixture();
    await f.db.db.nodes.updateMany(
      { blobKey: f.a.key },
      { tags: ["red", "big"] },
    );
    await f.db.db.nodes.updateMany({ blobKey: f.b.key }, { tags: ["red"] });
    expect(names(await list(f, { filter: { tags: ["red"] } }))).toEqual([
      "A.png",
      "b.txt",
    ]);
    expect(names(await list(f, { filter: { tags: ["red", "big"] } }))).toEqual([
      "b.txt",
    ]);
  });

  test("a keyset cursor walks every sort without a gap or a repeat", async () => {
    const f = await fixture();
    // More siblings, with equal sizes and names differing in case only.
    for (const n of ["e1.txt", "e2.txt", "e3.txt"])
      await files.addFile(
        f.workspace.owner,
        f.workspace.id,
        f.dir.id,
        n,
        "same",
      );
    for (const by of ["NAME", "DATE", "SIZE", "KIND"]) {
      for (const direction of ["ASC", "DESC"]) {
        const sort = { by, direction };
        const whole = names(await list(f, { sort, first: 50 }));
        const seen: string[] = [];
        let after: string | null = null;
        for (let i = 0; i < 20; i++) {
          const page: Awaited<ReturnType<typeof list>> = await list(f, {
            sort,
            first: 2,
            after,
          });
          expect(page.errors).toBeUndefined();
          seen.push(...names(page));
          const info = page.data?.["nodes"].pageInfo as {
            endCursor: string | null;
            hasNextPage: boolean;
          };
          if (!info.hasNextPage) break;
          after = info.endCursor;
        }
        expect(seen).toEqual(whole);
        expect(new Set(seen).size).toBe(seen.length);
      }
    }
  });

  test("a cursor survives a new sibling and is refused under another sort or filter", async () => {
    const f = await fixture();
    const sort = { by: "SIZE", direction: "ASC" };
    const first = await list(f, { sort, first: 3 });
    const cursor = first.data?.["nodes"].pageInfo.endCursor as string;
    await files.addFile(
      f.workspace.owner,
      f.workspace.id,
      f.dir.id,
      "late.txt",
      "q".repeat(5),
    );
    const next = await list(f, { sort, first: 50, after: cursor });
    expect(next.errors).toBeUndefined();
    const seen = [...names(first), ...names(next)];
    expect(new Set(seen).size).toBe(seen.length);
    const wrongSort = await list(f, {
      sort: { by: "NAME", direction: "ASC" },
      after: cursor,
    });
    expect(f.w.codeOf(wrongSort)).toBe("validation.errors.invalid-cursor");
    const wrongFilter = await list(f, {
      sort,
      filter: { name: "a" },
      after: cursor,
    });
    expect(f.w.codeOf(wrongFilter)).toBe("validation.errors.invalid-cursor");
    const garbage = await list(f, { after: "not-a-cursor" });
    expect(f.w.codeOf(garbage)).toBe("validation.errors.invalid-cursor");
  });

  test("a trashed or other folder's node is not listed", async () => {
    const f = await fixture();
    const other = await f.owner.folder((await f.owner.root()).id, "other");
    const g = await files.addFile(
      f.workspace.owner,
      f.workspace.id,
      other.id,
      "elsewhere.txt",
    );
    expect(names(await list(f, {}))).not.toContain(g.name);
    await f.db.db.nodes.updateMany(
      { blobKey: f.a.key },
      { trashedAt: new Date() },
    );
    expect(names(await list(f, {}))).not.toContain("b.txt");
  });

  test("a forged cursor carrying an operator is refused", async () => {
    const f = await fixture();
    const first = await list(f, { first: 1 });
    const cursor = first.data?.["nodes"].pageInfo.endCursor as string;
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    parsed.v[1] = { $ne: null };
    const forged = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    expect(f.w.codeOf(await list(f, { after: forged }))).toBe(
      "validation.errors.invalid-cursor",
    );
  });
});
