import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { LIST, listKit } from "../../../test/nodes.list.harness";
import { NODE } from "./nodes.harness";

const files = filesWorld();
const { fixture, list, rows, names } = listKit(files);

const ONE = `query($id: ID!) { node(id: $id) { __typename ${NODE} ... on File { key size } } }`;

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
});
