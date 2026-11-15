import type { Context } from "@/http/context";
import { audit, memberActor } from "../audit";

// What janus-graphql answers of an invitation: never the code (that is
// `JanusIssuedInvitation.code`, which this file never reads).
interface Invitation {
  id: string;
  scope: string;
  email: string;
  name?: string;
  role: string;
}

// `issueInvitation` and `resendInvitation` answer `{ invitation, code }`,
// `revokeInvitation` the invitation itself.
export const invitationOf = (answer: unknown): Invitation => {
  const found = answer as { invitation?: Invitation } & Invitation;
  return found.invitation ?? found;
};

// The inviter's events: the target is the invitation (named by its address),
// the actor the signed-in member who did it.
export async function recordInvitationWrite(
  action: "issue" | "resend" | "revoke",
  ctx: Context,
  answer: unknown,
): Promise<void> {
  const invitation = invitationOf(answer);
  if (!ctx.viewer) return;
  await audit.record({
    workspaceId: invitation.scope,
    actor: memberActor(ctx.viewer),
    action: `invitation.${action}`,
    target: { type: "INVITATION", id: invitation.id, name: invitation.email },
    ip: ctx.ip,
    meta: { role: invitation.role },
  });
}

// The invitee's: who accepted is the account the invitation made or found, the
// session's `userId` when the accept signed it in, else the account of the
// invited address.
export async function recordInvitationAccept(
  ctx: Context,
  invitation: Invitation,
  answer: unknown,
): Promise<void> {
  let accountId = (answer as { userId?: string }).userId;
  if (!accountId) {
    try {
      accountId = (await ctx.identity.accounts.byEmail(invitation.email))
        ?.accountId;
    } catch {
      // The accept has committed: an unreadable account is no reason to fail.
    }
  }
  if (!accountId) return;
  await audit.record({
    workspaceId: invitation.scope,
    actor: { type: "MEMBER", id: accountId, label: invitation.name ?? null },
    action: "invitation.accept",
    target: { type: "INVITATION", id: invitation.id, name: invitation.email },
    ip: ctx.ip,
    meta: { role: invitation.role },
  });
}
