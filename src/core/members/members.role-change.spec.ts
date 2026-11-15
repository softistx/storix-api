import { describe, expect, spyOn, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";
import { actionsOf, storedEvents } from "../audit/audit.harness";

describe("a role change whose account lookup fails", () => {
  test("is returned and recorded: the change has committed", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    const lookup = spyOn(w.h.identity.accounts, "byIds").mockRejectedValue(
      new Error("identity.errors.unavailable"),
    );
    const result = await w.send(
      workspace.owner,
      `mutation { changeMemberRole(memberId: "${member.memberId}", role: ADMIN) { role name } }`,
      { workspace: workspace.id },
    );
    expect(lookup).toHaveBeenCalled();
    lookup.mockRestore();
    expect(result.errors).toBeUndefined();
    expect(result.data?.["changeMemberRole"]).toEqual({
      role: "ADMIN",
      name: null,
    });
    const events = await storedEvents(workspace.id);
    expect(actionsOf(events)).toContain("member.role-change");
  });
});
