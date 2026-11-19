import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../test/workspaces.harness";
import { addMember, membersMongo } from "../members";

const MEMBERS = "{ members { totalCount nodes { id accountId role } } }";
const WORKSPACE = "{ workspace { id slug myRole } }";

// A member of one workspace reads nothing of another: not through the tenant
// header, not through a direct id, not through a list.
describe("workspace isolation", () => {
  test("a member of A who names B in the header is told it does not exist", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    for (const ref of [b.id, b.slug, b.slug.toUpperCase()]) {
      for (const query of [MEMBERS, WORKSPACE]) {
        const result = await w.send(a.owner, query, { workspace: ref });
        expect(w.codeOf(result)).toBe("workspaces.errors.not-found");
        expect(result.response.status).toBe(404);
        expect(result.data).toBeNull();
      }
    }
  });

  test("a foreign workspace is told exactly as an unknown one, so none leaks", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const foreign = await w.send(a.owner, MEMBERS, { workspace: b.id });
    const unknown = await w.send(a.owner, MEMBERS, {
      workspace: "64b7f0c2a1d3e4f5a6b7c8d9",
    });
    const slug = await w.send(a.owner, MEMBERS, { workspace: "no-such-one" });
    for (const result of [foreign, unknown, slug]) {
      expect(w.codeOf(result)).toBe("workspaces.errors.not-found");
      expect(result.response.status).toBe(404);
    }
    expect(JSON.stringify(foreign.errors)).toBe(JSON.stringify(unknown.errors));
  });

  test("the workspace's own members see only its own members", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const inA = await w.join(a, "MEMBER");
    const inB = await w.join(b, "ADMIN");
    const seenFromA = await w.send(inA.user, MEMBERS, { workspace: a.id });
    const accounts = (
      (seenFromA.data?.["members"]?.nodes ?? []) as { accountId: string }[]
    ).map((n) => n.accountId);
    expect(accounts.sort()).toEqual(
      [a.owner.principal.accountId, inA.user.principal.accountId].sort(),
    );
    expect(accounts).not.toContain(inB.user.principal.accountId);
    expect(seenFromA.data?.["members"].totalCount).toBe(2);
  });

  test("a member id of B used in A's workspace is not found, and nothing of B changes", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const target = await w.join(b, "MEMBER");
    for (const query of [
      `mutation { changeMemberRole(memberId: "${target.memberId}", role: ADMIN) { id } }`,
      `mutation { removeMember(memberId: "${target.memberId}") }`,
    ]) {
      const result = await w.send(a.owner, query, { workspace: a.id });
      expect(w.codeOf(result)).toBe("members.errors.not-found");
      expect(result.response.status).toBe(404);
    }
    const stillThere = await w.send(b.owner, MEMBERS, { workspace: b.id });
    const row = (
      (stillThere.data?.["members"]?.nodes ?? []) as {
        id: string;
        role: string;
      }[]
    ).find((n) => n.id === target.memberId);
    expect(row?.role).toBe("MEMBER");
  });

  test("a member of both reads each through its own header, never the other", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const both = await w.join(a, "MEMBER");
    await addMember(membersMongo(tenancy.core), {
      workspaceId: b.id,
      accountId: both.user.principal.accountId,
      role: "ADMIN",
      actorId: b.owner.principal.accountId,
    });
    const fromA = await w.send(both.user, WORKSPACE, { workspace: a.id });
    const fromB = await w.send(both.user, WORKSPACE, { workspace: b.slug });
    expect(fromA.data?.["workspace"]).toMatchObject({
      id: a.id,
      myRole: "MEMBER",
    });
    expect(fromB.data?.["workspace"]).toMatchObject({
      id: b.id,
      myRole: "ADMIN",
    });
  });

  test("myWorkspaces lists only the caller's own workspaces", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    const mine = await w.send(a.owner, "{ myWorkspaces { id myRole } }");
    expect(mine.data?.["myWorkspaces"]).toEqual([
      { id: a.id, myRole: "OWNER" },
    ]);
    const theirs = await w.send(b.owner, "{ myWorkspaces { id } }");
    expect(theirs.data?.["myWorkspaces"]).toEqual([{ id: b.id }]);
  });

  test("a member who left, or an account that never joined, is not a member", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const m = await w.join(a, "MEMBER");
    const stranger = await w.h.account();
    expect(w.codeOf(await w.send(stranger, MEMBERS, { workspace: a.id }))).toBe(
      "workspaces.errors.not-found",
    );
    const left = await w.send(m.user, "mutation { leaveWorkspace }", {
      workspace: a.id,
    });
    expect(left.errors).toBeUndefined();
    expect(w.codeOf(await w.send(m.user, MEMBERS, { workspace: a.id }))).toBe(
      "workspaces.errors.not-found",
    );
  });

  test("no session is 401 and no header is 400", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const anonymous = await w.send(null, MEMBERS, { workspace: a.id });
    expect(w.codeOf(anonymous)).toBe("auth.errors.unauthenticated");
    expect(anonymous.response.status).toBe(401);
    const none = await w.send(a.owner, MEMBERS);
    expect(w.codeOf(none)).toBe("workspaces.errors.workspace-required");
    expect(none.response.status).toBe(400);
  });

  test("a personal API key is refused on a workspace, even its owner's", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const key = await w.h.apiKey(a.owner);
    const result = await w.h.client.query(MEMBERS, {
      headers: { authorization: `Bearer ${key}`, "x-storix-workspace": a.id },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.api-key-not-accepted",
    );
    expect(result.response.status).toBe(401);
  });
});
