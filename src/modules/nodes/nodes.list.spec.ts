import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import {
  type FileView,
  filesWorld,
  pdf,
  png,
} from "../../../test/files.harness";
import type { FilesMongo } from "../files/files.service";
import { NODE, setup } from "./nodes.harness";

const files = filesWorld();

const LIST = `query($parentId: ID!, $filter: NodeFilter, $sort: NodeSort, $first: Int, $after: String) {
  nodes(parentId: $parentId, filter: $filter, sort: $sort, first: $first, after: $after) {
    nodes { ${NODE} ... on File { key size family tags mimeType } }
    pageInfo { endCursor hasNextPage }
  }
}`;
const ONE = `query($id: ID!) { node(id: $id) { __typename ${NODE} ... on File { key size } } }`;

interface Row {
  id: string;
  type: string;
  name: string;
  size?: number;
  family?: string;
}

// A folder holding two subfolders and files of different type, size and age.
async function fixture() {
  const s = await setup(files.ctx.w);
  const { workspace, owner } = s;
  const root = await owner.root();
  const dir = await owner.folder(root.id, "box");
  await owner.folder(dir.id, "zeta");
  await owner.folder(dir.id, "Alpha");
  const add = (name: string, body: string | Uint8Array, type: string) =>
    files.addFile(workspace.owner, workspace.id, dir.id, name, body, type);
  const a = await add("b.txt", "x".repeat(30), "text/plain");
  await Bun.sleep(5);
  const b = await add("A.png", png(12), "image/png");
  await Bun.sleep(5);
  const c = await add("c.pdf", pdf(100), "application/pdf");
  await Bun.sleep(5);
  const d = await add("d.png", png(20), "image/png");
  const db = (await store.databaseOf(workspace.id)) as unknown as FilesMongo;
  return { ...s, dir, a, b, c, d, db };
}

const list = async (
  f: Awaited<ReturnType<typeof fixture>>,
  variables: Record<string, unknown>,
) => {
  const r = await f.w.send(f.workspace.owner, LIST, {
    ...f.at,
    variables: { parentId: f.dir.id, ...variables },
  });
  return r;
};
const rows = (r: Awaited<ReturnType<typeof list>>) =>
  (r.data?.["nodes"].nodes ?? []) as Row[];
const names = (r: Awaited<ReturnType<typeof list>>) =>
  rows(r).map((n) => n.name);

describe("node and nodes", () => {
  test("node answers a folder or a file by its type", async () => {
    const f = await fixture();
    const one = await f.w.send(f.workspace.owner, ONE, {
      ...f.at,
      variables: { id: f.a.id },
    });
    expect(one.data?.["node"]).toMatchObject({
      __typename: "File",
      name: "b.txt",
      size: 30,
    });
    const folder = await f.w.send(f.workspace.owner, ONE, {
      ...f.at,
      variables: { id: f.dir.id },
    });
    expect(folder.data?.["node"]).toMatchObject({ __typename: "Folder" });
    const other = await f.w.send(f.workspace.owner, ONE, {
      ...f.at,
      variables: { id: crypto.randomUUID() },
    });
    expect(f.w.codeOf(other)).toBe("nodes.errors.not-found");
  });

  test("another member's node and folder are not found", async () => {
    const f = await fixture();
    const m = await f.w.join(f.workspace, "MEMBER");
    const one = await f.w.send(m.user, ONE, {
      ...f.at,
      variables: { id: f.a.id },
    });
    expect(f.w.codeOf(one)).toBe("nodes.errors.not-found");
    const l = await f.w.send(m.user, LIST, {
      ...f.at,
      variables: { parentId: f.dir.id },
    });
    expect(f.w.codeOf(l)).toBe("nodes.errors.not-found");
  });

  test("lists folders first, then by name (default), in either direction", async () => {
    const f = await fixture();
    expect(names(await list(f, {}))).toEqual([
      "Alpha",
      "zeta",
      "A.png",
      "b.txt",
      "c.pdf",
      "d.png",
    ]);
    expect(
      names(await list(f, { sort: { by: "NAME", direction: "DESC" } })),
    ).toEqual(["zeta", "Alpha", "d.png", "c.pdf", "b.txt", "A.png"]);
  });

  test("sorts by date, size and kind", async () => {
    const f = await fixture();
    const files_ = (r: Awaited<ReturnType<typeof list>>) =>
      rows(r)
        .filter((n) => n.type === "FILE")
        .map((n) => n.name);
    const by = async (by: string, direction: string) =>
      files_(await list(f, { sort: { by, direction } }));
    expect(await by("SIZE", "ASC")).toEqual([
      "A.png",
      "d.png",
      "b.txt",
      "c.pdf",
    ]);
    expect(await by("SIZE", "DESC")).toEqual([
      "c.pdf",
      "b.txt",
      "d.png",
      "A.png",
    ]);
    expect(await by("KIND", "ASC")).toEqual([
      "b.txt",
      "A.png",
      "d.png",
      "c.pdf",
    ]);
    expect((await by("DATE", "ASC")).slice(0, 4)).toEqual([
      "b.txt",
      "A.png",
      "c.pdf",
      "d.png",
    ]);
    expect(await by("DATE", "DESC")).toEqual([
      "d.png",
      "c.pdf",
      "A.png",
      "b.txt",
    ]);
    // Folders stay first under every sort.
    const all = rows(
      await list(f, { sort: { by: "SIZE", direction: "DESC" } }),
    );
    expect(all.slice(0, 2).every((n) => n.type === "FOLDER")).toBe(true);
  });

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

export type { FileView };
