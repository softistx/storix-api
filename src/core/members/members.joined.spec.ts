import { describe, expect, spyOn, test } from "bun:test";
import { members } from "@/config/wiring";
import { world } from "../../../test/workspaces.harness";

describe("a join listener", () => {
  test("is told who joined, and a failing one never undoes the join nor stops the others", async () => {
    const told: string[] = [];
    const w = await world({
      members: {
        ...members,
        onJoined: [
          ...members.onJoined,
          async () => {
            throw new Error("set-up failed");
          },
          async (_, joined) => {
            told.push(joined.accountId);
          },
        ],
      },
    });
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const workspace = await w.workspaceOf();
      expect(log).toHaveBeenCalled();
      expect(told).toEqual([workspace.owner.principal.accountId]);
      const mine = await w.send(
        workspace.owner,
        "{ workspace { id myRole } }",
        {
          workspace: workspace.id,
        },
      );
      expect(mine.errors).toBeUndefined();
      // The nodes listener ran first: the member has their root folder.
      const roots = await w.send(workspace.owner, "{ roots { name } }", {
        workspace: workspace.id,
      });
      expect(roots.data?.["roots"]).toEqual([{ name: "My files" }]);
    } finally {
      log.mockRestore();
    }
  });

  test("a workspace database that cannot be opened is logged, the join stands", async () => {
    const w = await world({
      members: {
        ...members,
        databaseOf: async () => {
          throw new Error("no database");
        },
      },
    });
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const workspace = await w.workspaceOf();
      expect(String(log.mock.calls[0]?.[0])).toContain("could not be opened");
      expect(workspace.id).toBeString();
    } finally {
      log.mockRestore();
    }
  });
});
