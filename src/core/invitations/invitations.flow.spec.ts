import { describe, expect, test } from "bun:test";
import { PASSWORD } from "@/core/identity/identity.harness";
import { DAY, ISSUE, PREVIEW, setup } from "./invitations.flow.harness";

describe("an invitation to a new account", () => {
  test("is mailed, previewed, accepted with a password and makes a member", async () => {
    const { w, workspace, invite, accept, members } = await setup();
    const email = w.h.email();
    const { code, issued } = await invite(email);
    // The code reaches the invitee's inbox only: the response keeps it back.
    expect(issued.data?.["issueInvitation"].code).toBeNull();
    expect(w.h.mailsTo(email)).toHaveLength(1);

    const preview = await w.send(null, PREVIEW, { variables: { code } });
    expect(preview.errors).toBeUndefined();
    expect(preview.data?.["invitationPreview"]).toEqual({
      organization: `Name ${workspace.slug}`,
      role: "ADMIN",
      email,
      needsPassword: true,
    });

    const accepted = await accept(code, PASSWORD);
    expect(accepted.errors).toBeUndefined();
    const result = accepted.data?.["acceptInvitation"];
    expect(result.__typename).toBe("InvitationSignedIn");
    expect(result.scope).toBe(workspace.id);
    expect(result.role).toBe("ADMIN");
    // The answer is the session of the new account, which now belongs to the
    // workspace with the invited role.
    const listed = await members();
    expect(listed.find((m) => m.accountId === result.userId)).toMatchObject({
      email,
      role: "ADMIN",
    });
    const mine = await w.send(
      { headers: { authorization: `Bearer ${result.token}` } } as never,
      "{ myWorkspaces { id myRole } }",
    );
    expect(mine.data?.["myWorkspaces"]).toEqual([
      { id: workspace.id, myRole: "ADMIN" },
    ]);
  });

  test("asks for a password when the invitee has no account", async () => {
    const { w, invite, accept, members } = await setup();
    const { code } = await invite(w.h.email());
    const refused = await accept(code);
    expect(w.codeOf(refused)).toBe("invitations.errors.password-required");
    expect(refused.response.status).toBe(400);
    expect(await members()).toHaveLength(1);
  });

  test("a spent code is refused, as is an unknown one", async () => {
    const { w, invite, accept, members } = await setup();
    const { code } = await invite(w.h.email());
    expect((await accept(code, PASSWORD)).errors).toBeUndefined();
    const again = await accept(code, PASSWORD);
    expect(w.codeOf(again)).toBe("invitations.errors.already-accepted");
    expect(again.response.status).toBe(400);
    expect(await members()).toHaveLength(2);

    const unknown = await accept("a".repeat(43), PASSWORD);
    expect(w.codeOf(unknown)).toBe("invitations.errors.invalid");
    const preview = await w.send(null, PREVIEW, { variables: { code } });
    expect(w.codeOf(preview)).toBe("invitations.errors.already-accepted");
  });

  test("a code past its seven days is refused", async () => {
    const { w, invite, accept } = await setup();
    const { code } = await invite(w.h.email());
    w.h.clock.advance(7 * DAY + 1000);
    const refused = await accept(code, PASSWORD);
    expect(w.codeOf(refused)).toBe("invitations.errors.expired");
    const preview = await w.send(null, PREVIEW, { variables: { code } });
    expect(w.codeOf(preview)).toBe("invitations.errors.expired");
    // the owner's own session lapsed with the clock, so membership is not read
    // again: the accept was refused before it could add anyone.
  });

  test("a code of a workspace that is no longer active is refused, preview and accept", async () => {
    const { w, workspace, invite, accept } = await setup();
    const { code } = await invite(w.h.email());
    await w.archive(workspace);
    const preview = await w.send(null, PREVIEW, { variables: { code } });
    expect(w.codeOf(preview)).toBe("invitations.errors.invalid");
    const refused = await accept(code, PASSWORD);
    expect(w.codeOf(refused)).toBe("invitations.errors.invalid");
    expect(refused.response.status).toBe(400);
  });

  test("a code just inside its seven days still works", async () => {
    const { w, invite, accept } = await setup();
    const { code } = await invite(w.h.email());
    w.h.clock.advance(7 * DAY - 60_000);
    expect((await accept(code, PASSWORD)).errors).toBeUndefined();
  });
});

describe("an invitation to an existing account", () => {
  test("adds it to the workspace without signing it in", async () => {
    const { w, invite, accept, members } = await setup();
    const person = await w.h.account();
    const { code } = await invite(person.email, "MEMBER");
    const accepted = await accept(code);
    expect(accepted.errors).toBeUndefined();
    // The inbox is proved, not who holds the account: no session is opened.
    expect(accepted.data?.["acceptInvitation"]).toMatchObject({
      __typename: "InvitationSignIn",
      email: person.email,
    });
    expect(await members()).toContainEqual(
      expect.objectContaining({
        accountId: person.principal.accountId,
        role: "MEMBER",
      }),
    );
  });

  test("a current member cannot be invited", async () => {
    const { w, workspace } = await setup();
    const member = await w.join(workspace, "MEMBER");
    const before = w.h.mailsTo(member.user.email).length;
    const refused = await w.send(workspace.owner, ISSUE, {
      workspace: workspace.id,
      variables: {
        scope: workspace.id,
        email: member.user.email,
        role: "MEMBER",
      },
    });
    expect(w.codeOf(refused)).toBe("invitations.errors.already-member");
    expect(refused.response.status).toBe(409);
    expect(w.h.mailsTo(member.user.email)).toHaveLength(before);
  });
});
