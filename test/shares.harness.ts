import { setup } from "../src/modules/nodes/nodes.harness";
import { FILE, type filesWorld } from "./files.harness";

export const GRANT = "id nodeId principal { type id } role grantedBy createdAt";
export const SHARE = `mutation($id: ID!, $principal: GrantPrincipalInput!, $role: GrantRole!) { shareNode(id: $id, principal: $principal, role: $role) { ${GRANT} } }`;
export const CHANGE = `mutation($id: ID!, $grantId: ID!, $role: GrantRole!) { changeGrant(id: $id, grantId: $grantId, role: $role) { ${GRANT} } }`;
export const UNSHARE = `mutation($id: ID!, $grantId: ID!) { unshareNode(id: $id, grantId: $grantId) { ${GRANT} } }`;
export const NODE_ROLE = `query($id: ID!) { node(id: $id) { id name myRole grants { ${GRANT} } } }`;
const TEAM = `mutation($name: String!) { createTeam(name: $name) { id } }`;
const SET_TEAM = `mutation($id: ID!, $ids: [ID!]!) { setTeamMembers(id: $id, memberIds: $ids) { id } }`;
const TRASH = `mutation($ids: [ID!]!) { trashNodes(ids: $ids) { id } }`;
export const ADD_VERSION = `mutation($fileId: ID!, $key: String!) { addFileVersion(fileId: $fileId, key: $key) { ${FILE} } }`;
export const VERSIONS = `query($id: ID!) { node(id: $id) { ... on File { versions { number } } } }`;

// A workspace with an owner who has a shared folder holding a file, and one
// member per standing: an editor and a viewer by grant, a member of a team
// that holds a viewer grant, and a stranger with no grant.
export async function sharesArea(files: ReturnType<typeof filesWorld>) {
  const s = await setup(files.ctx.w);
  const { w, workspace, owner } = s;
  const ws = workspace.id;
  const root = await owner.root();
  const editor = await w.join(workspace, "MEMBER");
  const viewer = await w.join(workspace, "MEMBER");
  const teamer = await w.join(workspace, "MEMBER");
  const stranger = await w.join(workspace, "MEMBER");
  const folder = await owner.folder(root.id, "Shared");
  const file = await files.addFile(
    workspace.owner,
    ws,
    folder.id,
    "doc.txt",
    "doc",
  );
  const sendAs = (
    user: typeof workspace.owner,
    query: string,
    variables?: Record<string, unknown>,
  ) => w.send(user, query, { workspace: ws, ...(variables && { variables }) });
  const share = async (
    id: string,
    type: "MEMBER" | "TEAM",
    principalId: string,
    role: "VIEWER" | "EDITOR",
  ) => {
    const result = await sendAs(workspace.owner, SHARE, {
      id,
      principal: { type, id: principalId },
      role,
    });
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    return result.data?.["shareNode"] as { id: string; role: string };
  };
  const team = await sendAs(workspace.owner, TEAM, { name: "Readers" });
  const teamId: string = team.data?.["createTeam"].id;
  await sendAs(workspace.owner, SET_TEAM, {
    id: teamId,
    ids: [teamer.memberId],
  });
  const grants = {
    editor: await share(folder.id, "MEMBER", editor.memberId, "EDITOR"),
    viewer: await share(folder.id, "MEMBER", viewer.memberId, "VIEWER"),
    team: await share(folder.id, "TEAM", teamId, "VIEWER"),
  };
  // Every standing, as the user that speaks for it.
  const users = {
    owner: workspace.owner,
    editor: editor.user,
    viewer: viewer.user,
    team: teamer.user,
    stranger: stranger.user,
  };
  const media = (user: typeof workspace.owner, key: string) =>
    files.call(user, ws, `/media/files/${key}`);
  return {
    ...s,
    files,
    folder,
    file,
    grants,
    teamId,
    strangerId: stranger.memberId,
    memberIds: { editor: editor.memberId, viewer: viewer.memberId },
    users,
    sendAs,
    share,
    media,
    trash: (user: typeof workspace.owner, id: string) =>
      sendAs(user, TRASH, { ids: [id] }),
  };
}
