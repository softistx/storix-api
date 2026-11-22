import { describe, expect, test } from "bun:test";
import { world } from "../../../../test/workspaces.harness";

const TEAM = "id name memberIds memberCount";
const CREATE = `mutation($name: String!) { createTeam(name: $name) { ${TEAM} } }`;
const SET = `mutation($id: ID!, $ids: [ID!]!) { setTeamMembers(id: $id, memberIds: $ids) { ${TEAM} } }`;
const ONE = `query($id: ID!) { team(id: $id) { ${TEAM} } }`;
const REMOVE = "mutation($id: ID!) { removeMember(memberId: $id) }";
const LEAVE = "mutation { leaveWorkspace }";

async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const at = { workspace: workspace.id };
  const created = await w.send(workspace.owner, CREATE, {
    ...at,
    variables: { name: "Design" },
  });
  const teamId: string = created.data?.["createTeam"].id;
  const set = (ids: string[], id = teamId) =>
    w.send(workspace.owner, SET, { ...at, variables: { id, ids } });
  const read = async (id = teamId) =>
    (await w.send(workspace.owner, ONE, { ...at, variables: { id } })).data?.[
      "team"
    ];
  return { w, workspace, at, teamId, set, read };
}

describe("setTeamMembers", () => {
  test("replaces the members, drops repeats and may empty the team", async () => {
    const { w, workspace, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    const b = await w.join(workspace, "ADMIN");
    const first = await set([a.memberId, b.memberId, a.memberId]);
    expect(first.errors).toBeUndefined();
    expect(first.data?.["setTeamMembers"].memberCount).toBe(2);
    expect(new Set((await read()).memberIds)).toEqual(
      new Set([a.memberId, b.memberId]),
    );
    const second = await set([b.memberId]);
    expect(second.data?.["setTeamMembers"].memberIds).toEqual([b.memberId]);
    const empty = await set([]);
    expect(empty.data?.["setTeamMembers"]).toMatchObject({
      memberIds: [],
      memberCount: 0,
    });
  });

  test("an owner is a member like another and may be in a team", async () => {
    const { w, workspace, set } = await setup();
    const own = await w.memberIdOf(workspace, workspace.owner);
    const result = await set([own]);
    expect(result.data?.["setTeamMembers"].memberIds).toEqual([own]);
  });

  test("refuses an id that is not a member, and changes nothing", async () => {
    const { w, workspace, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await set([a.memberId]);
    const ghost = "000000000000000000000000";
    for (const bad of [ghost, "not-an-id"]) {
      const result = await set([a.memberId, bad]);
      expect(w.codeOf(result)).toBe("teams.errors.member-unknown");
      expect(result.response.status).toBe(400);
    }
    expect((await read()).memberIds).toEqual([a.memberId]);
  });

  test("refuses a member of another workspace", async () => {
    const { w, set } = await setup();
    const other = await w.workspaceOf();
    const foreign = await w.memberIdOf(other, other.owner);
    expect(w.codeOf(await set([foreign]))).toBe("teams.errors.member-unknown");
  });

  test("refuses a member who left", async () => {
    const { w, workspace, at, set } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await w.send(workspace.owner, REMOVE, {
      ...at,
      variables: { id: a.memberId },
    });
    expect(w.codeOf(await set([a.memberId]))).toBe(
      "teams.errors.member-unknown",
    );
  });
});

describe("a removed member leaves their teams", () => {
  test("removeMember takes them out of every team, and only them", async () => {
    const { w, workspace, at, teamId, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    const b = await w.join(workspace, "MEMBER");
    const second = await w.send(workspace.owner, CREATE, {
      ...at,
      variables: { name: "Sales" },
    });
    const salesId: string = second.data?.["createTeam"].id;
    await set([a.memberId, b.memberId]);
    await set([a.memberId], salesId);
    const removed = await w.send(workspace.owner, REMOVE, {
      ...at,
      variables: { id: a.memberId },
    });
    expect(removed.errors).toBeUndefined();
    expect((await read(teamId)).memberIds).toEqual([b.memberId]);
    expect(await read(salesId)).toMatchObject({
      memberIds: [],
      memberCount: 0,
    });
  });

  test("leaveWorkspace takes the member out of their teams", async () => {
    const { w, workspace, at, teamId, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await set([a.memberId]);
    const left = await w.send(a.user, LEAVE, at);
    expect(left.errors).toBeUndefined();
    expect((await read(teamId)).memberIds).toEqual([]);
  });

  test("a member who is invited again does not come back to their teams", async () => {
    const { w, workspace, teamId, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await set([a.memberId]);
    await w.send(a.user, LEAVE, { workspace: workspace.id });
    const { addMember } = await import("@/core/members");
    const { tenancy } = await import("@/config/tenancy");
    await addMember(tenancy.core as never, {
      workspaceId: workspace.id,
      accountId: a.user.principal.accountId,
      role: "MEMBER",
      actorId: workspace.owner.principal.accountId,
    });
    expect((await read(teamId)).memberIds).toEqual([]);
  });

  test("a refused removal leaves the teams alone", async () => {
    const { w, workspace, at, teamId, set, read } = await setup();
    const own = await w.memberIdOf(workspace, workspace.owner);
    await set([own]);
    const refused = await w.send(workspace.owner, REMOVE, {
      ...at,
      variables: { id: own },
    });
    expect(w.codeOf(refused)).toBe("workspaces.errors.last-owner");
    expect((await read(teamId)).memberIds).toEqual([own]);
  });

  test("a stale id never shows even when the clean-up did not run", async () => {
    const { w, workspace, teamId, set, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await set([a.memberId]);
    // End the membership behind the API's back: no clean-up runs.
    const { tenancy } = await import("@/config/tenancy");
    const core = tenancy.core as unknown as {
      db: {
        members: { updateMany: (f: object, p: object) => Promise<number> };
      };
    };
    const { toObjectId } = await import("@softistx/mongo");
    await core.db.members.updateMany(
      { _id: toObjectId(a.memberId) },
      { removedAt: new Date() },
    );
    expect(await read(teamId)).toMatchObject({ memberIds: [], memberCount: 0 });
  });
});
