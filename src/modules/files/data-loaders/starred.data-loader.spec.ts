import { beforeAll, describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import { NODE } from "../../nodes/nodes.harness";
import { area as areaOf, STAR } from "../services/personal.harness";

const files = filesWorld();
let a: Awaited<ReturnType<typeof areaOf>>;
beforeAll(async () => {
  a = await areaOf(files);
});

const LISTING = `query($parentId: ID!) { nodes(parentId: $parentId, first: 100) { nodes { ${NODE} starred } } }`;

const flags = async (user: typeof a.owner) => {
  const r = await a.send(user, LISTING, { parentId: a.root.id });
  expect(r.errors).toBeUndefined();
  const nodes = (
    r.data as unknown as {
      nodes: { nodes: { name: string; starred: boolean }[] };
    }
  ).nodes.nodes;
  return new Map(nodes.map((n) => [n.name, n.starred]));
};

describe("Node.starred loader", () => {
  test("a listing flags the files and folders the caller starred, per caller", async () => {
    const x = await a.file("x.txt");
    await a.file("y.txt");
    const dir = await a.as(a.workspace.owner).folder(a.root.id, "docs");
    await a.send(a.owner, STAR, { id: x.id, starred: true });
    await a.send(a.owner, STAR, { id: dir.id, starred: true });
    const mine = await flags(a.owner);
    expect(mine.get("x.txt")).toBe(true);
    expect(mine.get("docs")).toBe(true);
    expect(mine.get("y.txt")).toBe(false);
    await a.send(a.owner, STAR, { id: x.id, starred: false });
    expect((await flags(a.owner)).get("x.txt")).toBe(false);
  });

  test("another member sees false for the owner's star", async () => {
    const f = await a.file("shared-star.txt");
    await a.send(a.owner, STAR, { id: f.id, starred: true });
    const other = await a.w.join(a.workspace, "MEMBER");
    const r = await a.send(other.user, LISTING, { parentId: a.root.id });
    const nodes = (
      r.data as unknown as {
        nodes: { nodes: { name: string; starred: boolean }[] };
      }
    )?.nodes?.nodes;
    const seen = nodes?.find((n) => n.name === "shared-star.txt");
    expect(seen?.starred ?? false).toBe(false);
    expect((await flags(a.owner)).get("shared-star.txt")).toBe(true);
  });

  test("a refused guard refuses the field, not a false", async () => {
    const elsewhere = await a.w.workspaceOf();
    const r = await a.w.send(elsewhere.owner, LISTING, {
      ...a.at,
      variables: { parentId: a.root.id },
    });
    expect(r.errors?.length ?? 0).toBeGreaterThan(0);
  });
});
