import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { NodeDoc } from "@/modules/nodes/public";
import { copyBlocker, copyOverflow } from "./copy.rules";

function node(parent: NodeDoc | null): NodeDoc {
  return {
    _id: new ObjectId(),
    parentId: parent ? parent._id : null,
    ancestors: parent ? [...parent.ancestors, parent._id] : [],
  } as unknown as NodeDoc;
}

describe("copyBlocker", () => {
  test("a root is locked", () => {
    expect(copyBlocker(node(null), node(null))).toBe("root-locked");
  });

  test("a folder never goes into itself or its own subtree", () => {
    const root = node(null);
    const top = node(root);
    const inside = node(top);
    expect(copyBlocker(top, top)).toBe("cycle");
    expect(copyBlocker(top, inside)).toBe("cycle");
  });

  test("a folder copied beside itself is fine", () => {
    const root = node(null);
    expect(copyBlocker(node(root), root)).toBeNull();
  });
});

describe("copyOverflow", () => {
  const root = node(null);
  const top = node(root);
  const child = node(top);
  const limits = { maxNodes: 3, maxDepth: 3 };

  test("counts the nodes already made, the top and what is below", () => {
    const input = { top, target: root, below: [child], limits };
    expect(copyOverflow({ ...input, made: 0 })).toBeNull();
    expect(copyOverflow({ ...input, made: 1 })).toBeNull();
    expect(copyOverflow({ ...input, made: 2 })).toBe("copy-too-large");
  });

  test("measures the depth of the copy under the target", () => {
    const grand = node(child);
    const input = { top, target: root, below: [child, grand], made: 0 };
    expect(
      copyOverflow({ ...input, limits: { maxNodes: 9, maxDepth: 4 } }),
    ).toBeNull();
    expect(
      copyOverflow({ ...input, limits: { maxNodes: 9, maxDepth: 3 } }),
    ).toBe("too-deep");
  });
});
