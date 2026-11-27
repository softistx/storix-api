import { describe, expect, test } from "bun:test";
import type { Context } from "@/http/context";
import { setup } from "../../../../test/nodes.harness";
import { ownerOf } from "./owner.data-loader";

const OWNER = "ownerId owner { accountId name }";
const NODE_OWNER = `query($id: ID!) { node(id: $id) { id ${OWNER} } }`;
const ROOTS_OWNER = `{ roots { id ${OWNER} } }`;
const LIST_OWNER = `query($parentId: ID!) { nodes(parentId: $parentId) { nodes { id ${OWNER} } } }`;

interface WithOwner {
  id: string;
  ownerId: string | null;
  owner: { accountId: string; name: string | null } | null;
}

describe("Node.owner", () => {
  test.each(["ADMIN", "MEMBER"] as const)(
    "a %s reads the owner of their own folder",
    async (role) => {
      const s = await setup();
      const { user } = await s.w.join(s.workspace, role);
      const as = s.as(user);
      const root = await as.root();
      const folder = await as.folder(root.id, "Docs");
      const accountId = user.principal.accountId;
      for (const id of [root.id, folder.id]) {
        const result = await as.send(NODE_OWNER, { id });
        expect(result.errors).toBeUndefined();
        const node = result.data?.["node"] as WithOwner;
        expect(node.ownerId).toBe(accountId);
        expect(node.owner?.accountId).toBe(accountId);
        expect(node.owner?.name).toBe(user.principal.name);
      }
    },
  );

  test("roots and listings carry the owner too", async () => {
    const s = await setup();
    const root = await s.owner.root();
    await s.owner.folder(root.id, "One");
    await s.owner.folder(root.id, "Two");
    const roots = await s.owner.send(ROOTS_OWNER);
    expect(
      (roots.data as { roots: WithOwner[] }).roots[0]?.owner,
    ).not.toBeNull();
    const list = await s.owner.send(LIST_OWNER, { parentId: root.id });
    const nodes = (list.data as { nodes: { nodes: WithOwner[] } }).nodes.nodes;
    expect(nodes).toHaveLength(2);
    for (const n of nodes) {
      expect(n.owner?.accountId).toBe(s.workspace.owner.principal.accountId);
    }
  });
});

// A deleted account is unreachable through the API (a node is readable only by
// its owner), so the lookup is exercised on the loader with a fake identity.
describe("ownerOf", () => {
  const ctxWith = (byIds: (ids: readonly string[]) => Promise<unknown[]>) =>
    ({ identity: { accounts: { byIds } } }) as unknown as Context;

  test("an account that no longer exists gives null, not an error", async () => {
    const ctx = ctxWith(async () => []);
    expect(await ownerOf({ ownerId: "gone" }, ctx)).toBeNull();
  });

  test("a node with no owner, or an identity failure, gives null", async () => {
    const down = ctxWith(async () => {
      throw new Error("identity unavailable");
    });
    expect(await ownerOf({ ownerId: null }, down)).toBeNull();
    expect(await ownerOf({ ownerId: "a" }, down)).toBeNull();
  });

  test("one lookup serves every node of a request", async () => {
    let calls = 0;
    const ctx = ctxWith(async (ids) => {
      calls++;
      return ids.map((id) => ({ accountId: id, name: `n-${id}` }));
    });
    const owners = await Promise.all(
      ["a", "b", "a", "b", "a"].map((ownerId) => ownerOf({ ownerId }, ctx)),
    );
    expect(owners.map((o) => o?.name)).toEqual([
      "n-a",
      "n-b",
      "n-a",
      "n-b",
      "n-a",
    ]);
    expect(calls).toBe(1);
  });
});
