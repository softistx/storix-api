import { describe, expect, test } from "bun:test";
import { PASSWORD } from "@/core/identity/identity.harness";
import { world } from "../../../test/workspaces.harness";

const DAY = 24 * 60 * 60 * 1000;

const ISSUE = `mutation($scope: String!, $email: String!, $role: WorkspaceRole!) {
  issueInvitation(scope: $scope, email: $email, name: "Grace", role: $role) {
    invitation { id role }
  }
}`;
const REVOKE = `mutation($scope: String!, $id: ID!) { revokeInvitation(scope: $scope, id: $id) { status } }`;
const ACCEPT = `mutation($code: String!) { acceptInvitation(code: $code, password: "${PASSWORD}") { __typename } }`;
const PREVIEW = `query($code: String!) { invitationPreview(code: $code) { role email } }`;

async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const invite = async (role = "MEMBER") => {
    const email = w.h.email();
    const issued = await w.send(workspace.owner, ISSUE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, email, role },
    });
    expect(issued.errors).toBeUndefined();
    await w.h.identity.settled();
    return {
      email,
      id: issued.data?.["issueInvitation"].invitation.id as string,
      code: w.h.invitationCodeFor(email),
    };
  };
  const both = async (code: string) => ({
    preview: await w.send(null, PREVIEW, { variables: { code } }),
    accept: await w.send(null, ACCEPT, { variables: { code } }),
  });
  return { w, workspace, invite, both };
}

describe("why an invitation code is refused", () => {
  test("a lapsed code is `expired`, in the preview and in the accept", async () => {
    const { w, invite, both } = await setup();
    const { code } = await invite();
    w.h.clock.advance(7 * DAY + 1000);
    const { preview, accept } = await both(code);
    for (const answer of [preview, accept]) {
      expect(w.codeOf(answer)).toBe("invitations.errors.expired");
      expect(answer.response.status).toBe(400);
    }
  });

  test("an accepted code is `already-accepted`", async () => {
    const { w, invite, both } = await setup();
    const { code } = await invite();
    expect((await w.send(null, ACCEPT, { variables: { code } })).errors).toBe(
      undefined,
    );
    const { preview, accept } = await both(code);
    expect(w.codeOf(preview)).toBe("invitations.errors.already-accepted");
    expect(w.codeOf(accept)).toBe("invitations.errors.already-accepted");
    expect(accept.response.status).toBe(400);
  });

  test("a withdrawn code is `revoked`", async () => {
    const { w, workspace, invite, both } = await setup();
    const { id, code } = await invite();
    await w.send(workspace.owner, REVOKE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, id },
    });
    const { preview, accept } = await both(code);
    expect(w.codeOf(preview)).toBe("invitations.errors.revoked");
    expect(w.codeOf(accept)).toBe("invitations.errors.revoked");
  });

  test("an unknown, malformed or replaced code stays `invalid`, and a live one passes", async () => {
    const { w, invite, both } = await setup();
    const { code } = await invite();
    const unknown = await both("a".repeat(43));
    expect(w.codeOf(unknown.preview)).toBe("invitations.errors.invalid");
    expect(w.codeOf(unknown.accept)).toBe("invitations.errors.invalid");
    const malformed = await both("short");
    expect(w.codeOf(malformed.preview)).toBe("invitations.errors.invalid");
    const live = await w.send(null, PREVIEW, { variables: { code } });
    expect(live.errors).toBeUndefined();
  });
});

describe("the invitation role", () => {
  test("is the WorkspaceRole enum on every invitation type", async () => {
    const { w } = await setup();
    const schema = await w.send(
      null,
      `{ __schema { types { name fields { name type { kind name ofType { name } } } } } }`,
    );
    const types = schema.data?.["__schema"].types as {
      name: string;
      fields:
        | {
            name: string;
            type: { name: string | null; ofType: { name: string } | null };
          }[]
        | null;
    }[];
    const roleOf = (type: string) => {
      const field = types
        .find((t) => t.name === type)
        ?.fields?.find((f) => f.name === "role")?.type;
      return field?.ofType?.name ?? field?.name;
    };
    for (const type of [
      "JanusInvitation",
      "JanusInvitationPreview",
      "InvitationSignedIn",
    ]) {
      expect(roleOf(type)).toBe("WorkspaceRole");
    }
  });

  test("an unknown role is refused, and the list filters by the enum", async () => {
    const { w, workspace, invite } = await setup();
    await invite("ADMIN");
    await invite("MEMBER");
    const refused = await w.send(workspace.owner, ISSUE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, email: w.h.email(), role: "admin" },
    });
    expect(refused.errors).toBeDefined();
    const admins = await w.send(
      workspace.owner,
      `query($scope: String!) { invitations(scope: $scope, role: ADMIN) { totalCount items { role } } }`,
      { workspace: workspace.id, variables: { scope: workspace.id } },
    );
    expect(admins.errors).toBeUndefined();
    expect(admins.data?.["invitations"]).toEqual({
      totalCount: 1,
      items: [{ role: "ADMIN" }],
    });
  });
});

describe("the mailed link", () => {
  test("carries the code in the fragment of /invitations/accept, not a query parameter", async () => {
    const { w, invite } = await setup();
    const { email, code } = await invite();
    const text = w.h.mailsTo(email).at(-1)?.text ?? "";
    expect(text).toMatch(new RegExp(`/invitations/accept#${code}`));
    expect(text).not.toContain("token=");
    expect(text).not.toContain("code=");
  });
});
