import { describe, expect, test } from "bun:test";
import { setup } from "../nodes.harness";

const LIST = `query($parentId: ID!) { nodes(parentId: $parentId) { nodes { id myRole grants { id } } } }`;

interface Listed {
  id: string;
  myRole: string;
  grants: unknown[];
}

interface Page {
  nodes: { nodes: Listed[] };
}

describe("roles data-loader", () => {
  test("a page of nodes resolves every role and grant list in one pass", async () => {
    const s = await setup();
    const root = await s.owner.root();
    const names = ["A", "B", "C"];
    for (const name of names) await s.owner.folder(root.id, name);
    const result = await s.owner.send(LIST, { parentId: root.id });
    expect(result.errors).toBeUndefined();
    const data: Page = result.data as unknown as Page;
    const nodes = data.nodes.nodes;
    expect(nodes).toHaveLength(names.length);
    for (const node of nodes) {
      expect(node.myRole).toBe("OWNER");
      expect(node.grants).toEqual([]);
    }
  });

  test("a member sees their own role on their own folders", async () => {
    const s = await setup();
    const { user } = await s.w.join(s.workspace, "MEMBER");
    const as = s.as(user);
    const root = await as.root();
    await as.folder(root.id, "Mine");
    const result = await as.send(LIST, { parentId: root.id });
    expect(result.errors).toBeUndefined();
    const data: Page = result.data as unknown as Page;
    const nodes = data.nodes.nodes;
    expect(nodes.map((n) => n.myRole)).toEqual(["OWNER"]);
  });
});
