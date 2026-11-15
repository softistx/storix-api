import { describe, expect, spyOn, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";
import { onMemberRemoved } from "./index";

describe("a member-removed listener that throws", () => {
  test("never undoes the removal nor stops the listeners after it", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    const told: string[] = [];
    const unregister = [
      onMemberRemoved(async () => {
        throw new Error("clean-up failed");
      }),
      onMemberRemoved(async (_, removal) => {
        told.push(removal.memberId);
      }),
    ];
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await w.send(
        workspace.owner,
        `mutation { removeMember(memberId: "${member.memberId}") }`,
        { workspace: workspace.id },
      );
      expect(log).toHaveBeenCalled();
      expect(result.errors).toBeUndefined();
      expect(result.data?.["removeMember"]).toBe(true);
      expect(told).toEqual([member.memberId]);
      const page = await w.send(
        workspace.owner,
        "{ members(first: 50) { nodes { id } } }",
        { workspace: workspace.id },
      );
      const nodes = (page.data?.["members"]?.nodes ?? []) as { id: string }[];
      const ids = nodes.map((n) => n.id);
      expect(ids).not.toContain(member.memberId);
    } finally {
      log.mockRestore();
      for (const off of unregister) off();
    }
  });
});
