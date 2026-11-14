import { describe, expect, test } from "bun:test";
import { world } from "../workspaces/workspaces.harness";
import type { WorkspaceRole } from "./roles";

type Outcome = "ok" | "forbidden";

// One operation, against what, and what each role gets. Each case runs on a
// fresh workspace with a fresh target, so no case sees another's changes.
interface Operation {
  name: string;
  // The role of the target the operation acts on, when there is one.
  target?: WorkspaceRole;
  query: (target: string) => string;
  expected: Record<WorkspaceRole, Outcome>;
}

const ALL_OK = { OWNER: "ok", ADMIN: "ok", MEMBER: "ok" } as const;
const STAFF = { OWNER: "ok", ADMIN: "ok", MEMBER: "forbidden" } as const;
const OWNERS = {
  OWNER: "ok",
  ADMIN: "forbidden",
  MEMBER: "forbidden",
} as const;

const operations: Operation[] = [
  { name: "workspace", query: () => "{ workspace { id } }", expected: ALL_OK },
  {
    name: "members",
    query: () => "{ members { totalCount } }",
    expected: ALL_OK,
  },
  {
    name: "changeMemberRole: a member to ADMIN",
    target: "MEMBER",
    query: (id) =>
      `mutation { changeMemberRole(memberId: "${id}", role: ADMIN) { role } }`,
    expected: STAFF,
  },
  {
    name: "changeMemberRole: a member to OWNER",
    target: "MEMBER",
    query: (id) =>
      `mutation { changeMemberRole(memberId: "${id}", role: OWNER) { role } }`,
    expected: OWNERS,
  },
  {
    name: "changeMemberRole: an owner to ADMIN",
    target: "OWNER",
    query: (id) =>
      `mutation { changeMemberRole(memberId: "${id}", role: ADMIN) { role } }`,
    expected: OWNERS,
  },
  {
    name: "removeMember: a member",
    target: "MEMBER",
    query: (id) => `mutation { removeMember(memberId: "${id}") }`,
    expected: STAFF,
  },
  {
    name: "removeMember: an owner",
    target: "OWNER",
    query: (id) => `mutation { removeMember(memberId: "${id}") }`,
    expected: OWNERS,
  },
  {
    name: "leaveWorkspace",
    query: () => "mutation { leaveWorkspace }",
    expected: ALL_OK,
  },
];

describe("the role matrix: each role against each operation", () => {
  for (const operation of operations) {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      test(`${role} ${operation.expected[role] === "ok" ? "may" : "may not"} ${operation.name}`, async () => {
        const w = await world();
        const workspace = await w.workspaceOf();
        // A second owner, so that nothing here hits the last-owner rule.
        await w.join(workspace, "OWNER");
        const actor =
          role === "OWNER"
            ? workspace.owner
            : (await w.join(workspace, role)).user;
        const target = operation.target
          ? (await w.join(workspace, operation.target)).memberId
          : "";
        const result = await w.send(actor, operation.query(target), {
          workspace: workspace.id,
        });
        if (operation.expected[role] === "ok") {
          expect(result.errors).toBeUndefined();
        } else {
          expect(w.codeOf(result)).toBe("auth.errors.forbidden");
          expect(result.response.status).toBe(403);
        }
      });
    }
  }

  test("a refused change leaves the member as they were", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const admin = await w.join(workspace, "ADMIN");
    const member = await w.join(workspace, "MEMBER");
    const refused = await w.send(
      admin.user,
      `mutation { changeMemberRole(memberId: "${member.memberId}", role: OWNER) { role } }`,
      { workspace: workspace.id },
    );
    expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
    const page = await w.send(
      workspace.owner,
      "{ members { nodes { id role } } }",
      {
        workspace: workspace.id,
      },
    );
    const nodes = page.data?.["members"].nodes as {
      id: string;
      role: string;
    }[];
    expect(nodes.find((n) => n.id === member.memberId)?.role).toBe("MEMBER");
  });

  test("an owner changes a role and the page shows the new one with the account's name", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    const result = await w.send(
      workspace.owner,
      `mutation { changeMemberRole(memberId: "${member.memberId}", role: ADMIN) { id role name email } }`,
      { workspace: workspace.id },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.["changeMemberRole"]).toEqual({
      id: member.memberId,
      role: "ADMIN",
      name: "Ada",
      email: member.user.email,
    });
  });

  test("members pages by cursor, oldest first", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    await w.join(workspace, "MEMBER");
    await w.join(workspace, "MEMBER");
    const query = `query($after: String) { members(first: 2, after: $after) { totalCount nodes { id } pageInfo { hasNextPage endCursor } } }`;
    const first = await w.send(workspace.owner, query, {
      workspace: workspace.id,
    });
    const page = first.data?.["members"];
    expect(page.totalCount).toBe(3);
    expect(page.nodes).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const second = await w.send(workspace.owner, query, {
      workspace: workspace.id,
      variables: { after: page.pageInfo.endCursor },
    });
    expect(second.data?.["members"].nodes).toHaveLength(1);
    expect(second.data?.["members"].pageInfo.hasNextPage).toBe(false);
  });

  test("a member id that is not an id, or of nobody, is 404", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    for (const id of ["nope", "64b7f0c2a1d3e4f5a6b7c8d9"]) {
      const result = await w.send(
        workspace.owner,
        `mutation { removeMember(memberId: "${id}") }`,
        { workspace: workspace.id },
      );
      expect(w.codeOf(result)).toBe("members.errors.not-found");
    }
  });
});
