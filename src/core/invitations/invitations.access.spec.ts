import { describe, expect, test } from "bun:test";
import type { Limits } from "@/http/rate-limits";
import { rateLimited } from "@/i18n/fail";
import { world } from "../../../test/workspaces.harness";

const FRESH = 10 * 60 * 1000;

const ISSUE = `mutation($scope: String!, $email: String!, $role: WorkspaceRole!) {
  issueInvitation(scope: $scope, email: $email, name: "Grace", role: $role) {
    invitation { id }
  }
}`;
const REVOKE = `mutation($scope: String!, $id: ID!) {
  revokeInvitation(scope: $scope, id: $id) { status }
}`;

async function setup(options: { limits?: Limits } = {}) {
  const w = await world(options);
  const workspace = await w.workspaceOf();
  const issue = (
    who: Parameters<typeof w.send>[0],
    role: string,
    scope = workspace.id,
    email = w.h.email(),
  ) =>
    w.send(who, ISSUE, {
      workspace: workspace.id,
      variables: { scope, email, role },
    });
  return { w, workspace, issue };
}

describe("who may invite", () => {
  test("owners and admins invite; members do not", async () => {
    const { w, workspace, issue } = await setup();
    const admin = await w.join(workspace, "ADMIN");
    const member = await w.join(workspace, "MEMBER");
    expect((await issue(workspace.owner, "MEMBER")).errors).toBeUndefined();
    expect((await issue(admin.user, "MEMBER")).errors).toBeUndefined();
    const refused = await issue(member.user, "MEMBER");
    expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
    expect(refused.response.status).toBe(403);
  });

  test("only an owner invites an owner", async () => {
    const { w, workspace, issue } = await setup();
    const admin = await w.join(workspace, "ADMIN");
    const refused = await issue(admin.user, "OWNER");
    expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
    expect((await issue(workspace.owner, "OWNER")).errors).toBeUndefined();
  });

  test("only an owner resends or revokes an owner's invitation", async () => {
    const { w, workspace, issue } = await setup();
    const admin = await w.join(workspace, "ADMIN");
    const issued = await issue(workspace.owner, "OWNER");
    const id = issued.data?.["issueInvitation"].invitation.id as string;
    const RESEND = `mutation($scope: String!, $id: ID!) {
      resendInvitation(scope: $scope, id: $id) { invitation { status } }
    }`;
    const vars = {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    };
    expect(w.codeOf(await w.send(admin.user, RESEND, vars))).toBe(
      "auth.errors.forbidden",
    );
    expect(w.codeOf(await w.send(admin.user, REVOKE, vars))).toBe(
      "auth.errors.forbidden",
    );
    expect(
      (await w.send(workspace.owner, RESEND, vars)).errors,
    ).toBeUndefined();
  });

  test("a role that is not a workspace role is refused as input", async () => {
    const { workspace, issue } = await setup();
    const refused = await issue(workspace.owner, "ROOT");
    // The enum is checked by GraphQL itself, before any resolver runs.
    expect(JSON.stringify(refused.errors)).toContain("WorkspaceRole");
  });

  test("an anonymous caller is 401, a key is refused, no header is 400", async () => {
    const { w, workspace, issue } = await setup();
    const anonymous = await issue(null, "MEMBER");
    expect(w.codeOf(anonymous)).toBe("auth.errors.unauthenticated");
    const token = await w.h.apiKey(workspace.owner);
    const key = await issue(
      { headers: { authorization: `Bearer ${token}` } } as never,
      "MEMBER",
    );
    expect(w.codeOf(key)).toBe("auth.errors.api-key-not-accepted");
    const bare = await w.send(workspace.owner, ISSUE, {
      variables: {
        scope: workspace.id,
        email: w.h.email(),
        role: "MEMBER",
      },
    });
    expect(w.codeOf(bare)).toBe("workspaces.errors.workspace-required");
  });

  test("another workspace's scope is not found, and nothing is mailed", async () => {
    const { w, workspace, issue } = await setup();
    const other = await w.workspaceOf();
    const email = w.h.email();
    const refused = await issue(workspace.owner, "MEMBER", other.id, email);
    expect(w.codeOf(refused)).toBe("invitations.errors.not-found");
    expect(refused.response.status).toBe(404);
    expect(w.h.mailsTo(email)).toHaveLength(0);
  });

  test("an admin of one workspace cannot see another's invitations", async () => {
    const { w, workspace } = await setup();
    const other = await w.workspaceOf();
    const listed = await w.send(
      workspace.owner,
      `query($scope: String!) { invitations(scope: $scope) { totalCount } }`,
      { workspace: workspace.id, variables: { scope: other.id } },
    );
    expect(w.codeOf(listed)).toBe("invitations.errors.not-found");
  });
});

describe("a fresh session", () => {
  test("issuing needs one, after the permission", async () => {
    const { w, workspace, issue } = await setup();
    const member = await w.join(workspace, "MEMBER");
    w.h.clock.advance(FRESH + 1000);
    const email = w.h.email();
    const stale = await issue(workspace.owner, "MEMBER", workspace.id, email);
    expect(w.codeOf(stale)).toBe("auth.errors.step-up-required");
    expect(stale.response.status).toBe(403);
    expect(w.h.mailsTo(email)).toHaveLength(0);
    // A caller who may not invite learns nothing from the step-up.
    expect(w.codeOf(await issue(member.user, "MEMBER"))).toBe(
      "auth.errors.forbidden",
    );
  });

  test("revoking needs one", async () => {
    const { w, workspace, issue } = await setup();
    const issued = await issue(workspace.owner, "MEMBER");
    const id = issued.data?.["issueInvitation"].invitation.id as string;
    w.h.clock.advance(FRESH + 1000);
    const stale = await w.send(workspace.owner, REVOKE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    expect(w.codeOf(stale)).toBe("auth.errors.step-up-required");
  });
});

describe("throttling", () => {
  const unlimited = (over: Partial<Limits>): Limits => ({
    signUp: async () => undefined,
    signIn: async () => undefined,
    passwordReset: async () => undefined,
    workspaceCreate: async () => undefined,
    invitationSend: async () => undefined,
    invitationCode: async () => undefined,
    ...over,
  });

  test("sends are counted per inviter and refused past the window, with no mail", async () => {
    const counted: (string | undefined)[] = [];
    const { w, workspace, issue } = await setup({
      limits: unlimited({
        invitationSend: async (inviter) => {
          counted.push(inviter);
          if (counted.length > 2) throw rateLimited(120);
        },
      }),
    });
    expect((await issue(workspace.owner, "MEMBER")).errors).toBeUndefined();
    expect((await issue(workspace.owner, "MEMBER")).errors).toBeUndefined();
    const email = w.h.email();
    const refused = await issue(workspace.owner, "MEMBER", workspace.id, email);
    expect(w.codeOf(refused)).toBe("auth.errors.rate-limited");
    expect(refused.response.status).toBe(429);
    expect(new Set(counted)).toEqual(
      new Set([workspace.owner.principal.accountId]),
    );
    await w.h.identity.settled();
    expect(w.h.mailsTo(email)).toHaveLength(0);
  });

  test("a refused request is not counted as a send", async () => {
    const counted: (string | undefined)[] = [];
    const { w, workspace, issue } = await setup({
      limits: unlimited({ invitationSend: async (i) => void counted.push(i) }),
    });
    const member = await w.join(workspace, "MEMBER");
    await issue(member.user, "MEMBER");
    expect(counted).toHaveLength(0);
  });

  test("previews and accepts are counted per address and refused past the window", async () => {
    let calls = 0;
    const { w } = await setup({
      limits: unlimited({
        invitationCode: async () => {
          if (++calls > 1) throw rateLimited(60);
        },
      }),
    });
    const guess = "a".repeat(43);
    const first = await w.send(
      null,
      `query($c: String!) { invitationPreview(code: $c) { email } }`,
      { variables: { c: guess } },
    );
    expect(w.codeOf(first)).toBe("invitations.errors.invalid");
    const second = await w.send(
      null,
      `mutation($c: String!) { acceptInvitation(code: $c, password: "x") { __typename } }`,
      { variables: { c: guess } },
    );
    expect(w.codeOf(second)).toBe("auth.errors.rate-limited");
    expect(second.response.status).toBe(429);
  });
});
