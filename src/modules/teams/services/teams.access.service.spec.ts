import { describe, expect, test } from "bun:test";
import { world } from "../../../../test/workspaces.harness";

const CREATE = "mutation($name: String!) { createTeam(name: $name) { id } }";
const RENAME =
  'mutation($id: ID!) { renameTeam(id: $id, name: "Renamed") { id } }';
const SET =
  "mutation($id: ID!) { setTeamMembers(id: $id, memberIds: []) { id } }";
const DELETE = "mutation($id: ID!) { deleteTeam(id: $id) }";
const LIST = "{ teams { id } }";
const ONE = "query($id: ID!) { team(id: $id) { id name } }";

describe("who may use teams", () => {
  test("every role reads, only OWNER and ADMIN manage", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const at = { workspace: workspace.id };
    const admin = await w.join(workspace, "ADMIN");
    const member = await w.join(workspace, "MEMBER");
    const made = await w.send(workspace.owner, CREATE, {
      ...at,
      variables: { name: "Design" },
    });
    const id: string = made.data?.["createTeam"].id;

    for (const user of [workspace.owner, admin.user, member.user]) {
      expect((await w.send(user, LIST, at)).errors).toBeUndefined();
      expect(
        (await w.send(user, ONE, { ...at, variables: { id } })).errors,
      ).toBeUndefined();
    }
    for (const [query, variables] of [
      [CREATE, { name: "Nope" }],
      [RENAME, { id }],
      [SET, { id }],
      [DELETE, { id }],
    ] as const) {
      const refused = await w.send(member.user, query, { ...at, variables });
      expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
      expect(refused.response.status).toBe(403);
    }
    const byAdmin = await w.send(admin.user, CREATE, {
      ...at,
      variables: { name: "Admin's" },
    });
    expect(byAdmin.errors).toBeUndefined();
    // The member's attempts changed nothing.
    const list = await w.send(workspace.owner, LIST, at);
    expect(list.data?.["teams"]).toHaveLength(2);
  });

  test("a stranger and a visitor without a header or a session get nothing", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const stranger = await w.h.account();
    const at = { workspace: workspace.id };
    const notMember = await w.send(stranger, LIST, at);
    expect(w.codeOf(notMember)).toBe("workspaces.errors.not-found");
    expect(notMember.response.status).toBe(404);
    const noHeader = await w.send(workspace.owner, LIST);
    expect(w.codeOf(noHeader)).toBe("workspaces.errors.workspace-required");
    const anonymous = await w.send(null, LIST, at);
    expect(w.codeOf(anonymous)).toBe("auth.errors.unauthenticated");
  });

  test("a team of another workspace is a 404, whatever the operation", async () => {
    const w = await world();
    const mine = await w.workspaceOf();
    const theirs = await w.workspaceOf();
    const made = await w.send(theirs.owner, CREATE, {
      workspace: theirs.id,
      variables: { name: "Theirs" },
    });
    const id: string = made.data?.["createTeam"].id;
    // The caller owns both workspaces: the header alone scopes the request.
    const owner = mine.owner;
    for (const [query, variables] of [
      [ONE, { id }],
      [RENAME, { id }],
      [SET, { id }],
      [DELETE, { id }],
    ] as const) {
      const result = await w.send(owner, query, {
        workspace: mine.id,
        variables,
      });
      expect(w.codeOf(result)).toBe("teams.errors.not-found");
      expect(result.response.status).toBe(404);
    }
    const list = await w.send(owner, LIST, { workspace: mine.id });
    expect(list.data?.["teams"]).toEqual([]);
    // And the team is untouched where it lives.
    const still = await w.send(theirs.owner, ONE, {
      workspace: theirs.id,
      variables: { id },
    });
    expect(still.data?.["team"].name).toBe("Theirs");
  });
});
