import { describe, expect, spyOn, test } from "bun:test";
import { members } from "@/config/wiring";
import { world } from "../../../test/workspaces.harness";

describe("a member-removed listener that throws", () => {
  test("never undoes the removal nor stops the listeners after it", async () => {
    const told: string[] = [];
    const w = await world({
      members: {
        ...members,
        onRemoved: [
          ...members.onRemoved,
          async () => {
            throw new Error("clean-up failed");
          },
          async (_, removal) => {
            told.push(removal.memberId);
          },
        ],
      },
    });
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
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
    }
  });
});

describe("a removing listener that throws", () => {
  test("fails the removal and the member stays", async () => {
    const w = await world({
      members: {
        ...members,
        onRemoving: [
          ...members.onRemoving,
          async () => {
            throw new Error("grants not dropped");
          },
        ],
      },
    });
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await w.send(
        workspace.owner,
        `mutation { removeMember(memberId: "${member.memberId}") }`,
        { workspace: workspace.id },
      );
      expect(result.errors).toBeDefined();
      const page = await w.send(
        workspace.owner,
        "{ members(first: 50) { nodes { id } } }",
        { workspace: workspace.id },
      );
      const ids = (page.data?.["members"]?.nodes ?? []).map(
        (n: { id: string }) => n.id,
      );
      expect(ids).toContain(member.memberId);
    } finally {
      log.mockRestore();
    }
  });
});
