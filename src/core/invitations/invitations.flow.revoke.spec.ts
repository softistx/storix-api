import { describe, expect, test } from "bun:test";
import { PASSWORD } from "@/core/identity/identity.harness";
import { setup } from "./invitations.flow.harness";

describe("revoking and sending again", () => {
  const REVOKE = `mutation($scope: String!, $id: ID!) {
    revokeInvitation(scope: $scope, id: $id) { status }
  }`;
  const RESEND = `mutation($scope: String!, $id: ID!) {
    resendInvitation(scope: $scope, id: $id) { invitation { status } }
  }`;

  test("a revoked invitation cannot be accepted, nor revoked again", async () => {
    const { w, workspace, invite, accept, members } = await setup();
    const { id, code } = await invite(w.h.email());
    const revoked = await w.send(workspace.owner, REVOKE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    expect(revoked.data?.["revokeInvitation"]).toEqual({ status: "revoked" });
    const refused = await accept(code, PASSWORD);
    expect(w.codeOf(refused)).toBe("invitations.errors.revoked");
    const again = await w.send(workspace.owner, REVOKE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    expect(w.codeOf(again)).toBe("invitations.errors.not-pending");
    expect(again.response.status).toBe(409);
    expect(await members()).toHaveLength(1);
  });

  test("sending again mails a new code and retires the old one", async () => {
    const { w, workspace, invite, accept } = await setup();
    const email = w.h.email();
    const { id, code: first } = await invite(email);
    const resent = await w.send(workspace.owner, RESEND, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    expect(resent.errors).toBeUndefined();
    await w.h.identity.settled();
    expect(w.h.mailsTo(email)).toHaveLength(2);
    const second = w.h.invitationCodeFor(email);
    expect(second).not.toBe(first);
    expect(w.codeOf(await accept(first, PASSWORD))).toBe(
      "invitations.errors.invalid",
    );
    expect((await accept(second, PASSWORD)).errors).toBeUndefined();
  });

  test("an accepted invitation cannot be sent again", async () => {
    const { w, workspace, invite, accept } = await setup();
    const { id, code } = await invite(w.h.email());
    await accept(code, PASSWORD);
    const refused = await w.send(workspace.owner, RESEND, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    expect(w.codeOf(refused)).toBe("invitations.errors.not-pending");
  });

  test("the list shows each invitation with its status, never its code", async () => {
    const { w, workspace, invite } = await setup();
    const email = w.h.email();
    await invite(email);
    const page = await w.send(
      workspace.owner,
      `query($scope: String!) { invitations(scope: $scope) { totalCount items { email role status } } }`,
      { workspace: workspace.id, variables: { scope: workspace.id } },
    );
    expect(page.errors).toBeUndefined();
    expect(page.data?.["invitations"]).toEqual({
      totalCount: 1,
      items: [{ email, role: "ADMIN", status: "pending" }],
    });
  });
});
