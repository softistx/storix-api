import {
  janusInvitationTypeDefs,
  janusTypeDefs,
} from "@softistx/janus-graphql";

// The SDL of the invitation fields, as `@softistx/janus-graphql` ships it:
// `invitations`, `issueInvitation`, `resendInvitation`, `revokeInvitation`,
// `invitationPreview`, `acceptInvitation`. Only this folder imports janus.
// The SDL carries janus's directive declarations (`@authenticated`…): they do
// nothing here, `authorize` is the guard.
// An invitation's `role` is the workspace's `WorkspaceRole` enum (members.graphqls),
// where janus's SDL types it as a free string.
export const invitationTypeDefs: string = `${janusTypeDefs}\n${janusInvitationTypeDefs.replace(/\brole: String\b/g, "role: WorkspaceRole")}`;
