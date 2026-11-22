import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const DEMOTE = (id: string) =>
  `mutation { changeMemberRole(memberId: "${id}", role: ADMIN) { role } }`;
const REMOVE = (id: string) => `mutation { removeMember(memberId: "${id}") }`;
const LEAVE = "mutation { leaveWorkspace }";
const ROLES = "{ members { nodes { id role } } }";

describe("a workspace always keeps an owner", () => {
  test("the only owner cannot leave, demote themselves or be removed", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const own = await w.memberIdOf(workspace, workspace.owner);
    for (const query of [LEAVE, DEMOTE(own), REMOVE(own)]) {
      const result = await w.send(workspace.owner, query, {
        workspace: workspace.id,
      });
      expect(w.codeOf(result)).toBe("workspaces.errors.last-owner");
      expect(result.response.status).toBe(409);
    }
    const page = await w.send(workspace.owner, ROLES, {
      workspace: workspace.id,
    });
    expect(page.data?.["members"].nodes).toEqual([{ id: own, role: "OWNER" }]);
  });

  test("with a second owner, one may leave and then the other is the last", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const second = await w.join(workspace, "OWNER");
    const left = await w.send(workspace.owner, LEAVE, {
      workspace: workspace.id,
    });
    expect(left.errors).toBeUndefined();
    // The one who left is no longer a member.
    expect(
      w.codeOf(
        await w.send(workspace.owner, ROLES, { workspace: workspace.id }),
      ),
    ).toBe("workspaces.errors.not-found");
    const own = await w.memberIdOf(
      { id: workspace.id, owner: second.user },
      second.user,
    );
    const last = await w.send(second.user, LEAVE, { workspace: workspace.id });
    expect(w.codeOf(last)).toBe("workspaces.errors.last-owner");
    expect(
      w.codeOf(
        await w.send(second.user, DEMOTE(own), { workspace: workspace.id }),
      ),
    ).toBe("workspaces.errors.last-owner");
  });

  test("an owner demotes another owner, then is the last", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const second = await w.join(workspace, "OWNER");
    const demoted = await w.send(workspace.owner, DEMOTE(second.memberId), {
      workspace: workspace.id,
    });
    expect(demoted.errors).toBeUndefined();
    const own = await w.memberIdOf(workspace, workspace.owner);
    expect(
      w.codeOf(
        await w.send(workspace.owner, DEMOTE(own), { workspace: workspace.id }),
      ),
    ).toBe("workspaces.errors.last-owner");
  });

  test("two owners demoting each other at once leave exactly one owner", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const second = await w.join(workspace, "OWNER");
    const first = await w.memberIdOf(workspace, workspace.owner);
    const [a, b] = await Promise.all([
      w.send(workspace.owner, DEMOTE(second.memberId), {
        workspace: workspace.id,
      }),
      w.send(second.user, DEMOTE(first), { workspace: workspace.id }),
    ]);
    const outcomes = [a, b].map((r) => (r.errors ? w.codeOf(r) : "ok"));
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes).toContain("workspaces.errors.last-owner");
    // Whoever remains an owner reads the page.
    const reader = a.errors ? second.user : workspace.owner;
    const page = await w.send(reader, ROLES, { workspace: workspace.id });
    const roles = (
      (page.data?.["members"]?.nodes ?? []) as { role: string }[]
    ).map((n) => n.role);
    expect(roles.filter((r) => r === "OWNER")).toHaveLength(1);
  });

  test("an owner who left can be brought back with a role", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const second = await w.join(workspace, "OWNER");
    await w.send(second.user, LEAVE, { workspace: workspace.id });
    const { addMember } = await import("./services");
    const { tenancy } = await import("@/config/tenancy");
    await addMember(tenancy.core as never, {
      workspaceId: workspace.id,
      accountId: second.user.principal.accountId,
      role: "MEMBER",
      actorId: workspace.owner.principal.accountId,
    });
    const page = await w.send(workspace.owner, ROLES, {
      workspace: workspace.id,
    });
    expect(page.data?.["members"].nodes).toHaveLength(2);
    const back = await w.send(second.user, "{ workspace { myRole } }", {
      workspace: workspace.id,
    });
    expect(back.data?.["workspace"]).toEqual({ myRole: "MEMBER" });
  });
});
