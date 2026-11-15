import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { requireWorkspaceMember, requireWorkspacePermission } from "../access";
import { memberActor } from "../audit";
import type { Account } from "../identity";
import { recordLeave, recordRemoval, recordRoleChange } from "./members.audit";
import { memberRemoved } from "./members.removal";
import {
  changeRole,
  endMembership,
  listMembers,
  type MemberDoc,
  type MembersMongo,
} from "./members.service";

// The module's own handle on the core database (the scope's, typed by the
// registry; see src/core/access/ports.ts).
const handleOf = (scope: { readonly core: unknown }) =>
  scope.core as MembersMongo;

const memberView = (member: MemberDoc, account: Account | undefined) => ({
  id: member.id,
  accountId: member.accountId,
  name: account?.name ?? null,
  email: account?.email ?? null,
  role: member.role,
  joinedAt: member.createdAt,
});

// One call for the accounts of a page (the port's DataLoader source).
async function accountsOf(ctx: Context, members: readonly MemberDoc[]) {
  const accounts = await ctx.identity.accounts.byIds(
    members.map((member) => member.accountId),
  );
  return new Map(accounts.map((account) => [account.accountId, account]));
}

// The name of a member's account for the audit log, null when the account
// cannot be read: the removal has committed, so a failed lookup must not fail
// the request.
async function nameOf(ctx: Context, member: MemberDoc): Promise<string | null> {
  try {
    return (
      (await accountsOf(ctx, [member])).get(member.accountId)?.name ?? null
    );
  } catch {
    return null;
  }
}

export const membersResolvers: Resolvers = {
  Query: {
    members: async (_, { first, after }, ctx) => {
      const { scope } = await requireWorkspacePermission(ctx, "members:read");
      const page = await listMembers(handleOf(scope), {
        workspaceId: scope.tenant.id,
        first,
        after: after ?? null,
      });
      const accounts = await accountsOf(ctx, page.items);
      return {
        nodes: page.items.map((member) =>
          memberView(member, accounts.get(member.accountId)),
        ),
        pageInfo: {
          startCursor: after ?? null,
          endCursor: page.endCursor,
          hasNextPage: page.endCursor !== null,
          hasPreviousPage: after != null,
        },
        totalCount: page.totalCount,
      };
    },
  },
  Mutation: {
    changeMemberRole: async (_, { memberId, role }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "members:manage",
      );
      // A role change is sensitive: a fresh session, after the permission so
      // that a caller who may not change roles learns nothing from it.
      ctx.identity.assertFresh(principal);
      const { member, from } = await changeRole(handleOf(scope), {
        workspaceId: scope.tenant.id,
        memberId,
        role,
        actorId: principal.accountId,
        canManageOwners: ctx.access.roleCan(scope.member, "owners:manage"),
      });
      const accounts = await accountsOf(ctx, [member]);
      const view = memberView(member, accounts.get(member.accountId));
      if (from !== member.role) {
        await recordRoleChange({
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
          member,
          name: view.name,
          from,
          to: member.role,
        });
      }
      return view;
    },
    removeMember: async (_, { memberId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "members:manage",
      );
      // Removing someone is sensitive too (leaving is not): a fresh session.
      ctx.identity.assertFresh(principal);
      const removed = await endMembership(handleOf(scope), {
        workspaceId: scope.tenant.id,
        memberId,
        actorId: principal.accountId,
        canManageOwners: ctx.access.roleCan(scope.member, "owners:manage"),
      });
      await memberRemoved(scope, removed);
      await recordRemoval({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        member: removed,
        name: await nameOf(ctx, removed),
      });
      return true;
    },
    leaveWorkspace: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspaceMember(ctx);
      const left = await endMembership(handleOf(scope), {
        workspaceId: scope.tenant.id,
        accountId: principal.accountId,
        actorId: principal.accountId,
        canManageOwners: true,
      });
      await memberRemoved(scope, left);
      await recordLeave({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        member: left,
        name: principal.name,
      });
      return true;
    },
  },
};
