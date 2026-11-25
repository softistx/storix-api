import { describe, expect, test } from "bun:test";
import { nodesMongo } from "@/modules/nodes/public";
import { roleArea } from "../../../../test/roles.harness";
import { findLiveNode } from "./node.service";

describe("findLiveNode", () => {
  test("finds a live node by id, whoever owns it", async () => {
    const a = await roleArea();
    const node = await findLiveNode(a.database, a.child.id);
    expect(node?.name).toBe("Child");
    expect(node?.type).toBe("FOLDER");
  });

  test("a malformed id, an unknown one and a trashed node are undefined", async () => {
    const a = await roleArea();
    expect(await findLiveNode(a.database, "nope")).toBeUndefined();
    expect(await findLiveNode(a.database, "0".repeat(24))).toBeUndefined();
    const nodes = nodesMongo(a.database);
    await nodes.db.nodes.update(
      a.child.id as never,
      {
        trashedAt: new Date(),
      } as never,
    );
    expect(await findLiveNode(a.database, a.child.id)).toBeUndefined();
  });
});
