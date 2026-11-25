import { describe, expect, spyOn, test } from "bun:test";
import { Collection } from "mongodb";
import { roleArea } from "../../../../test/roles.harness";

const LIST = `query($parentId: ID!) { nodes(parentId: $parentId) { nodes { id myRole grants { id } } } }`;
const ONE = `query($id: ID!) { node(id: $id) { id myRole } }`;
const TRASH = `mutation($ids: [ID!]!) { trashNodes(ids: $ids) { id } }`;

interface Listed {
  id: string;
  myRole: string;
  grants: unknown[];
}

describe("roles data-loader", () => {
  test("a page of shared nodes reads the grants in a constant number of queries, not one per node", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    for (const name of ["A", "B", "C", "D"]) {
      await a.owner.folder(a.folder.id, name);
    }
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );
    const reads = spyOn(Collection.prototype, "find");
    const result = await a.as(guest.user).send(LIST, { parentId: a.folder.id });
    expect(result.errors).toBeUndefined();
    const data = result.data as unknown as { nodes: { nodes: Listed[] } };
    const nodes = data.nodes.nodes;
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    for (const node of nodes) {
      expect(node.myRole).toBe("VIEWER");
      expect(node.grants).toEqual([]);
    }
    // Only this workspace's database: the spy sees the whole process.
    const grantReads = reads.mock.contexts.filter(
      (c) =>
        (c as Collection).collectionName === "grants" &&
        (c as Collection).dbName.endsWith(a.workspace.id),
    );
    reads.mockRestore();
    // One for the listing itself, one batched `$in` for the roles of the page:
    // never one per node (the page holds five or more).
    expect(grantReads.length).toBeGreaterThanOrEqual(1);
    expect(grantReads.length).toBeLessThanOrEqual(2);
  });

  test("the owner reads OWNER on every node of a page", async () => {
    const a = await roleArea();
    const result = await a.owner.send(LIST, { parentId: a.root.id });
    const data = result.data as unknown as { nodes: { nodes: Listed[] } };
    expect(data.nodes.nodes.map((n) => n.myRole)).toEqual(
      data.nodes.nodes.map(() => "OWNER"),
    );
  });

  test("a trashed node gives a non-owner no role", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );
    const as = a.as(guest.user);
    const before = await as.send(ONE, { id: a.folder.id });
    const seen = before.data as unknown as { node: { myRole: string } };
    expect(seen.node.myRole).toBe("VIEWER");
    const trashed = await a.w.send(a.workspace.owner, TRASH, {
      ...a.at,
      variables: { ids: [a.folder.id] },
    });
    expect(trashed.errors).toBeUndefined();
    const after = await as.send(ONE, { id: a.folder.id });
    expect(after.data?.["node"] ?? null).toBeNull();
  });
});
