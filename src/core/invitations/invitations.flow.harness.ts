import { expect } from "bun:test";
import { world } from "../../../test/workspaces.harness";

export const DAY = 24 * 60 * 60 * 1000;

export const ISSUE = `mutation($scope: String!, $email: String!, $role: WorkspaceRole!) {
  issueInvitation(scope: $scope, email: $email, name: "Grace", role: $role) {
    invitation { id email role status } code
  }
}`;
export const ACCEPT = `mutation($code: String!, $password: String) {
  acceptInvitation(code: $code, password: $password) {
    __typename
    ... on InvitationSignedIn { token userId scope role }
    ... on InvitationSignIn { email scope }
  }
}`;
export const PREVIEW = `query($code: String!) {
  invitationPreview(code: $code) { organization role email needsPassword }
}`;

export async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const invite = async (email: string, role = "ADMIN") => {
    const issued = await w.send(workspace.owner, ISSUE, {
      workspace: workspace.id,
      variables: { scope: workspace.id, email, role },
    });
    expect(issued.errors).toBeUndefined();
    await w.h.identity.settled();
    return {
      id: issued.data?.["issueInvitation"].invitation.id as string,
      code: w.h.invitationCodeFor(email),
      issued,
    };
  };
  const accept = (code: string, password?: string) =>
    w.send(null, ACCEPT, { variables: { code, password: password ?? null } });
  const members = async () => {
    const page = await w.send(
      workspace.owner,
      "{ members(first: 50) { nodes { accountId email role } } }",
      { workspace: workspace.id },
    );
    return page.data?.["members"].nodes as {
      accountId: string;
      email: string;
      role: string;
    }[];
  };
  return { w, workspace, invite, accept, members };
}
