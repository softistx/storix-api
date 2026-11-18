import type { Context } from "@/http/context";
import { fail, forbidden, invalidInput } from "@/i18n/fail";
import { requireWorkspacePermission } from "../access";
import type { InvitationHooks } from "../identity";
import { type MembersMongo, membershipOf } from "../members";
import { activeWorkspaceName, workspacesMongo } from "../workspaces";
import { isRole } from "./invitations.service";

// What the invitation fields ask of the application. Everything an owner-side
// field does needs `members:manage` in the request's workspace (the
// `x-storix-workspace` header) and names that same workspace as its `scope`:
// any other scope is a 404, so a scope's existence is never revealed. Issuing
// or revoking is sensitive (it grants or withdraws access): a fresh session,
// after the permission. Making an owner is an owner's alone (`owners:manage`).
export const invitationHooks: InvitationHooks<Context> = {
  async authorize(action, subject, ctx) {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "members:manage",
    );
    if (scope.tenant.id !== subject.scope) return false;

    const role = subject.input?.role ?? subject.invitation?.role;
    if (subject.input && !isRole(subject.input.role)) {
      throw invalidInput([{ path: "role", code: "validation.errors.invalid" }]);
    }
    if (
      role === "OWNER" &&
      !ctx.access.roleCan(scope.member, "owners:manage")
    ) {
      throw forbidden();
    }
    if (action === "issue" || action === "revoke") {
      ctx.identity.assertFresh(principal);
    }
    if (subject.input) {
      const account = await ctx.identity.accounts.byEmail(subject.input.email);
      const members = scope.core as unknown as MembersMongo;
      if (
        account &&
        (await membershipOf(members)(scope.tenant.id, account.accountId))
      ) {
        throw fail("invitations.errors.already-member", {
          status: 409,
          field: "email",
        });
      }
    }
    // Each send is a mail: counted per inviter, after the refusals above.
    if (action === "issue" || action === "resend") {
      await ctx.limits.invitationSend(principal.accountId);
    }
    return true;
  },

  // Open to whoever holds a code (the preview): the workspace's name and
  // nothing else.
  async describeScope(scope, ctx) {
    const name = await activeWorkspaceName(
      workspacesMongo(ctx.tenancy.core),
      scope,
    );
    return name === null ? null : { name };
  },
};
