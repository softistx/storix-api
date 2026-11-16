import { describe, expect, test } from "bun:test";
import { PASSWORD } from "@/core/identity/identity.harness";
import { world } from "../../../test/workspaces.harness";
import { actionsOf, storedEvents } from "./audit.harness";

const ISSUE = `mutation($scope: String!, $email: String!) {
  issueInvitation(scope: $scope, email: $email, name: "Grace", role: MEMBER) {
    invitation { id } code
  }
}`;
const RESEND = `mutation($scope: String!, $id: ID!) {
  resendInvitation(scope: $scope, id: $id) { invitation { id } }
}`;
const REVOKE = `mutation($scope: String!, $id: ID!) {
  revokeInvitation(scope: $scope, id: $id) { id }
}`;
const ACCEPT = `mutation($code: String!, $password: String) {
  acceptInvitation(code: $code, password: $password) {
    __typename
    ... on InvitationSignedIn { token userId }
  }
}`;

// Every write of E1 leaves one event, after it committed, and no event holds a
// secret.
describe("the audit log of the E1 writes", () => {
  test("each write records its event with its actor, target and facts", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const at = { workspace: workspace.id };
    const owner = workspace.owner.principal;
    const secrets: string[] = [
      PASSWORD,
      workspace.owner.token,
      ...Object.values(workspace.owner.headers),
    ];

    // createWorkspace
    let events = await storedEvents(workspace.id);
    expect(actionsOf(events)).toEqual(["workspace.create"]);
    expect(events[0]).toMatchObject({
      actor: { type: "MEMBER", id: owner.accountId, label: owner.name },
      target: { type: "WORKSPACE", id: workspace.id },
      meta: { slug: workspace.slug },
    });

    // changeMemberRole, once for a real change and once for none
    const member = await w.join(workspace, "MEMBER");
    const promote = (role: string) =>
      w.send(
        workspace.owner,
        `mutation { changeMemberRole(memberId: "${member.memberId}", role: ${role}) { role } }`,
        at,
      );
    expect((await promote("ADMIN")).errors).toBeUndefined();
    expect((await promote("ADMIN")).errors).toBeUndefined();
    events = await storedEvents(workspace.id);
    expect(actionsOf(events).slice(1)).toEqual(["member.role-change"]);
    expect(events[1]).toMatchObject({
      actor: { id: owner.accountId },
      target: { type: "MEMBER", id: member.memberId },
      meta: {
        accountId: member.user.principal.accountId,
        from: "MEMBER",
        to: "ADMIN",
      },
    });

    // removeMember and leaveWorkspace
    const removed = await w.join(workspace, "MEMBER");
    await w.send(
      workspace.owner,
      `mutation { removeMember(memberId: "${removed.memberId}") }`,
      at,
    );
    const leaving = await w.join(workspace, "MEMBER");
    await w.send(leaving.user, "mutation { leaveWorkspace }", at);
    events = await storedEvents(workspace.id);
    expect(actionsOf(events).slice(2)).toEqual([
      "member.remove",
      "member.leave",
    ]);
    expect(events[2]).toMatchObject({
      actor: { id: owner.accountId },
      target: { id: removed.memberId },
      meta: { accountId: removed.user.principal.accountId, role: "MEMBER" },
    });
    expect(events[3]).toMatchObject({
      actor: { id: leaving.user.principal.accountId },
      target: { id: leaving.memberId },
    });

    // the team writes
    const team = await w.send(
      workspace.owner,
      'mutation { createTeam(name: "Design") { id } }',
      at,
    );
    const teamId: string = team.data?.["createTeam"].id;
    await w.send(
      workspace.owner,
      `mutation { renameTeam(id: "${teamId}", name: "Studio") { id } }`,
      at,
    );
    await w.send(
      workspace.owner,
      `mutation { setTeamMembers(id: "${teamId}", memberIds: ["${member.memberId}"]) { id } }`,
      at,
    );
    await w.send(
      workspace.owner,
      `mutation { deleteTeam(id: "${teamId}") }`,
      at,
    );
    events = await storedEvents(workspace.id);
    expect(actionsOf(events).slice(4)).toEqual([
      "team.create",
      "team.rename",
      "team.set-members",
      "team.delete",
    ]);
    expect(events[5]).toMatchObject({
      target: { type: "TEAM", id: teamId, name: "Studio" },
      meta: { from: "Design", to: "Studio" },
    });
    expect(events[6]?.meta).toEqual({ count: 1, added: 1, removed: 0 });
    expect(events[7]?.target).toMatchObject({ id: teamId, name: "Studio" });

    // the invitation writes: issue, resend, revoke, then issue and accept
    const invitee = w.h.email();
    const issued = await w.send(workspace.owner, ISSUE, {
      ...at,
      variables: { scope: workspace.id, email: invitee },
    });
    expect(issued.errors).toBeUndefined();
    await w.h.identity.settled();
    const invitationId: string = issued.data?.["issueInvitation"].invitation.id;
    secrets.push(w.h.invitationCodeFor(invitee));
    await w.send(workspace.owner, RESEND, {
      ...at,
      variables: { scope: workspace.id, id: invitationId },
    });
    await w.h.identity.settled();
    secrets.push(w.h.invitationCodeFor(invitee));
    await w.send(workspace.owner, REVOKE, {
      ...at,
      variables: { scope: workspace.id, id: invitationId },
    });
    const joiner = w.h.email();
    await w.send(workspace.owner, ISSUE, {
      ...at,
      variables: { scope: workspace.id, email: joiner },
    });
    await w.h.identity.settled();
    const code = w.h.invitationCodeFor(joiner);
    secrets.push(code);
    const accepted = await w.send(null, ACCEPT, {
      variables: { code, password: PASSWORD },
    });
    expect(accepted.errors).toBeUndefined();
    const result = accepted.data?.["acceptInvitation"];
    secrets.push(result.token);

    events = await storedEvents(workspace.id);
    expect(actionsOf(events).slice(8)).toEqual([
      "invitation.issue",
      "invitation.resend",
      "invitation.revoke",
      "invitation.issue",
      "invitation.accept",
    ]);
    expect(events[8]).toMatchObject({
      actor: { id: owner.accountId },
      target: { type: "INVITATION", id: invitationId, name: invitee },
      meta: { role: "MEMBER" },
    });
    expect(events[12]).toMatchObject({
      actor: { type: "MEMBER", id: result.userId },
      target: { type: "INVITATION", name: joiner },
    });

    // No event holds a password, a session token or an invitation code, and
    // an event lists the facts it names and nothing else.
    const log = JSON.stringify(events);
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(8);
      expect(log).not.toContain(secret);
    }
    for (const event of events) {
      expect(Object.keys(event.meta).join()).not.toMatch(
        /code|token|password|secret/i,
      );
    }
    // Every event is stamped when it happened.
    expect(events.every((event) => event.at instanceof Date)).toBe(true);
  });

  test("a refused write records nothing", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const member = await w.join(workspace, "MEMBER");
    const refused = await w.send(
      member.user,
      'mutation { createTeam(name: "Nope") { id } }',
      { workspace: workspace.id },
    );
    expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
    const lastOwner = await w.send(
      workspace.owner,
      "mutation { leaveWorkspace }",
      { workspace: workspace.id },
    );
    expect(w.codeOf(lastOwner)).toBe("workspaces.errors.last-owner");
    expect(actionsOf(await storedEvents(workspace.id))).toEqual([
      "workspace.create",
    ]);
  });

  test("a workspace's events are in its own database, never another's", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    await w.send(a.owner, 'mutation { createTeam(name: "Only A") { id } }', {
      workspace: a.id,
    });
    expect(actionsOf(await storedEvents(a.id))).toEqual([
      "workspace.create",
      "team.create",
    ]);
    expect(actionsOf(await storedEvents(b.id))).toEqual(["workspace.create"]);
  });
});
