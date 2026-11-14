import { describe, expect, test } from "bun:test";
import { world } from "../workspaces/workspaces.harness";

const FRESH = 10 * 60 * 1000;

const PROMOTE = (id: string) =>
  `mutation { changeMemberRole(memberId: "${id}", role: ADMIN) { role } }`;

describe("a role change needs a fresh session", () => {
  async function setup() {
    const w = await world();
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    return { w, workspace, member };
  }

  test("right after signing in the change goes through", async () => {
    const { w, workspace, member } = await setup();
    const result = await w.send(workspace.owner, PROMOTE(member.memberId), {
      workspace: workspace.id,
    });
    expect(result.errors).toBeUndefined();
  });

  test("a stale session is told to step up, and nothing changes", async () => {
    const { w, workspace, member } = await setup();
    w.h.clock.advance(FRESH + 1000);
    const result = await w.send(workspace.owner, PROMOTE(member.memberId), {
      workspace: workspace.id,
    });
    expect(w.codeOf(result)).toBe("auth.errors.step-up-required");
    expect(result.response.status).toBe(403);
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

  test("after requestStepUp and confirmStepUp the same change goes through", async () => {
    const { w, workspace, member } = await setup();
    w.h.clock.advance(FRESH + 1000);
    const asked = await w.send(
      workspace.owner,
      "mutation { requestStepUp { method challenge } }",
    );
    expect(asked.errors).toBeUndefined();
    await w.h.identity.settled();
    const confirmed = await w.send(
      workspace.owner,
      `mutation($c: String!, $code: String!) { confirmStepUp(challenge: $c, code: $code) }`,
      {
        variables: {
          c: asked.data?.["requestStepUp"].challenge,
          code: w.h.codeFor(workspace.owner.email),
        },
      },
    );
    expect(confirmed.errors).toBeUndefined();
    const result = await w.send(workspace.owner, PROMOTE(member.memberId), {
      workspace: workspace.id,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["changeMemberRole"]).toEqual({ role: "ADMIN" });
  });

  test("a caller who may not change roles is told so, not asked to step up", async () => {
    const { w, workspace, member } = await setup();
    const other = await w.join(workspace, "MEMBER");
    w.h.clock.advance(FRESH + 1000);
    const result = await w.send(other.user, PROMOTE(member.memberId), {
      workspace: workspace.id,
    });
    expect(w.codeOf(result)).toBe("auth.errors.forbidden");
  });

  test("a personal API key never changes a role", async () => {
    const { w, workspace, member } = await setup();
    const key = await w.h.apiKey(workspace.owner);
    const result = await w.h.client.query(PROMOTE(member.memberId), {
      headers: {
        authorization: `Bearer ${key}`,
        "x-storix-workspace": workspace.id,
      },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.api-key-not-accepted",
    );
  });

  test("removing a member and leaving ask for no step-up", async () => {
    const { w, workspace, member } = await setup();
    const other = await w.join(workspace, "MEMBER");
    w.h.clock.advance(FRESH + 1000);
    const removed = await w.send(
      workspace.owner,
      `mutation { removeMember(memberId: "${member.memberId}") }`,
      { workspace: workspace.id },
    );
    expect(removed.errors).toBeUndefined();
    const left = await w.send(other.user, "mutation { leaveWorkspace }", {
      workspace: workspace.id,
    });
    expect(left.errors).toBeUndefined();
  });
});
