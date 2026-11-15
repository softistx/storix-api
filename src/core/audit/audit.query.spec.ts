import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const EVENTS = `query($filter: AuditEventFilter, $first: Int!, $after: String) {
  auditEvents(filter: $filter, first: $first, after: $after) {
    nodes { id at action ipHash actor { type id label } target { type id name } meta }
    pageInfo { endCursor hasNextPage }
  }
}`;

async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const at = { workspace: workspace.id };
  const read = (
    user: Parameters<typeof w.send>[0],
    variables: Record<string, unknown> = {},
  ) => w.send(user, EVENTS, { ...at, variables: { first: 50, ...variables } });
  const team = async (name: string) =>
    w.send(
      workspace.owner,
      `mutation { createTeam(name: "${name}") { id } }`,
      at,
    );
  return { w, workspace, at, read, team };
}

describe("auditEvents", () => {
  test("an owner and an admin read the log, newest first", async () => {
    const { w, workspace, read, team } = await setup();
    await team("Design");
    const admin = await w.join(workspace, "ADMIN");
    for (const user of [workspace.owner, admin.user]) {
      const page = await read(user);
      expect(page.errors).toBeUndefined();
      const nodes = page.data?.["auditEvents"].nodes as { action: string }[];
      expect(nodes.map((n) => n.action)).toEqual([
        "team.create",
        "workspace.create",
      ]);
      expect(page.data?.["auditEvents"].pageInfo.hasNextPage).toBe(false);
    }
  });

  test("a member, an outsider, an API key and an anonymous caller are refused", async () => {
    const { w, workspace, at, read } = await setup();
    const member = await w.join(workspace, "MEMBER");
    expect(w.codeOf(await read(member.user))).toBe("auth.errors.forbidden");
    const outsider = await w.h.account();
    expect(w.codeOf(await read(outsider))).toBeDefined();
    expect(w.codeOf(await read(null))).toBe("auth.errors.unauthenticated");
    const key = await w.h.apiKey(workspace.owner);
    const viaKey = await w.send(
      { headers: { authorization: `Bearer ${key}` } } as never,
      EVENTS,
      { ...at, variables: { first: 5 } },
    );
    expect(w.codeOf(viaKey)).toBe("auth.errors.api-key-not-accepted");
  });

  test("filters by actor, action, target and period", async () => {
    const { w, workspace, read, team } = await setup();
    const admin = await w.join(workspace, "ADMIN");
    const made = await team("Design");
    const teamId = made.data?.["createTeam"].id as string;
    w.h.clock.advance(60_000);
    await w.send(
      admin.user,
      `mutation { renameTeam(id: "${teamId}", name: "Studio") { id } }`,
      { workspace: workspace.id },
    );
    const actions = async (filter: Record<string, unknown>) => {
      const page = await read(workspace.owner, { filter });
      const nodes = (page.data?.["auditEvents"]?.nodes ?? []) as {
        action: string;
      }[];
      return nodes.map((n) => n.action);
    };

    expect(await actions({ action: "team.rename" })).toEqual(["team.rename"]);
    expect(await actions({ actorId: admin.user.principal.accountId })).toEqual([
      "team.rename",
    ]);
    expect(await actions({ targetId: teamId })).toEqual([
      "team.rename",
      "team.create",
    ]);
    const all = (await read(workspace.owner)).data?.["auditEvents"].nodes as {
      at: string;
      action: string;
    }[];
    const renamed = all.find((n) => n.action === "team.rename");
    expect(await actions({ from: renamed?.at })).toEqual(["team.rename"]);
    expect(await actions({ to: renamed?.at })).toEqual([
      "team.create",
      "workspace.create",
    ]);
    expect(await actions({ actorId: "nobody" })).toEqual([]);
  });

  test("pages with a cursor, and refuses a cursor from another filter", async () => {
    const { w, workspace, read, team } = await setup();
    for (const name of ["A", "B", "C", "D"]) await team(name);
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const page = await read(workspace.owner, { first: 2, after });
      expect(page.errors).toBeUndefined();
      const result = page.data?.["auditEvents"] as {
        nodes: { id: string }[];
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
      };
      seen.push(...result.nodes.map((n) => n.id));
      after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
      pages++;
    } while (after);
    // workspace.create plus four teams, two per page, each once.
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(pages).toBe(3);

    const first = await read(workspace.owner, { first: 1 });
    const cursor = first.data?.["auditEvents"].pageInfo.endCursor as string;
    const other = await read(workspace.owner, {
      first: 1,
      after: cursor,
      filter: { action: "team.create" },
    });
    expect(w.codeOf(other)).toBe("validation.errors.invalid-cursor");
    const garbage = await read(workspace.owner, { after: "not-a-cursor" });
    expect(w.codeOf(garbage)).toBe("validation.errors.invalid-cursor");
  });

  test("never shows another workspace's events", async () => {
    const { w, workspace, read } = await setup();
    const other = await w.workspaceOf();
    await w.send(
      other.owner,
      'mutation { createTeam(name: "Theirs") { id } }',
      {
        workspace: other.id,
      },
    );
    const mine = (await read(workspace.owner)).data?.["auditEvents"].nodes as {
      action: string;
    }[];
    expect(mine.map((n) => n.action)).toEqual(["workspace.create"]);
    // An owner of one workspace is not allowed into the other's log.
    const crossed = await w.send(workspace.owner, EVENTS, {
      workspace: other.id,
      variables: { first: 5 },
    });
    expect(crossed.errors).toBeDefined();
  });
});
