import {
  addMember,
  type MembersMongo,
  memberJoined,
  type WorkspaceRole,
  workspaceRoles,
} from "../members";

// An invitation that was accepted: the account that accepted it joins its
// workspace with the invited role. janus runs this inside the accept, after
// the account exists (made, or the one the address already had). A person who
// is already a member keeps their row and role: the invitation was issued
// before they joined another way, and accepting it must not demote an owner.
// The actor of the new row is the inviter, or the person themselves for an
// invitation the system issued.
export async function joinWorkspace(
  mongo: MembersMongo,
  accepted: {
    scope: string;
    role: string;
    accountId: string;
    invitedBy: string | null;
  },
): Promise<void> {
  if (!isRole(accepted.role)) {
    // Unreachable: `authorize` only lets a workspace role be issued.
    throw new Error(`invitation to ${accepted.scope}: unknown role`);
  }
  const member = await addMember(mongo, {
    workspaceId: accepted.scope,
    accountId: accepted.accountId,
    role: accepted.role,
    actorId: accepted.invitedBy ?? accepted.accountId,
  });
  await memberJoined(member);
}

export const isRole = (role: string): role is WorkspaceRole =>
  (workspaceRoles as readonly string[]).includes(role);
