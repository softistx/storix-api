import type { Resolvers } from "@/generated/graphql/resolvers";
import { requireWorkspaceMember, requireWorkspacePermission } from "../access";
import { memberActor } from "../audit";
import {
  changeRole,
  endMembership,
  handOver,
  listMembers,
  type MemberDoc,
  memberRemoved,
  recordLeave,
  recordRemoval,
  recordRoleChange,
} from "./services";
import { accountOf, accountsOf, handleOf, memberView, nameOf } from "./utils";

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
      // The change has committed: an unreadable account only blanks the name.
      const account = await accountOf(ctx, member);
      const view = memberView(member, account);
      if (from !== member.role) {
        await recordRoleChange({
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
          auditor: ctx.audit,
          member,
          name: view.name,
          from,
          to: member.role,
        });
      }
      return view;
    },
    removeMember: async (_, { memberId, transferTo }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "members:manage",
      );
      // Removing someone is sensitive too (leaving is not): a fresh session.
      ctx.identity.assertFresh(principal);
      let name: string | null | undefined;
      let transferredTo: string | undefined;
      const removed = await endMembership(handleOf(scope), {
        workspaceId: scope.tenant.id,
        memberId,
        actorId: principal.accountId,
        canManageOwners: ctx.access.roleCan(scope.member, "owners:manage"),
        // The receiver is read inside the transaction (a bad one fails the
        // call before anything is removed). The files move before the removal
        // commits: a failed handover fails the call and nobody is removed.
        ...(transferTo
          ? {
              transferTo,
              beforeCommit: async (
                target: MemberDoc,
                receiver: MemberDoc | undefined,
              ) => {
                if (!receiver) return;
                name = await nameOf(ctx, target);
                if (
                  await handOver(ctx.members, scope, {
                    workspaceId: scope.tenant.id,
                    from: {
                      memberId: target.id,
                      accountId: target.accountId,
                      name,
                    },
                    to: {
                      memberId: receiver.id,
                      accountId: receiver.accountId,
                    },
                  })
                ) {
                  transferredTo = receiver.accountId;
                }
              },
            }
          : {}),
      });
      name = name === undefined ? await nameOf(ctx, removed) : name;
      await memberRemoved(ctx.members, scope, removed);
      await recordRemoval({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        auditor: ctx.audit,
        member: removed,
        name,
        transferredTo,
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
      await memberRemoved(ctx.members, scope, left);
      await recordLeave({
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        auditor: ctx.audit,
        member: left,
        name: principal.name,
      });
      return true;
    },
  },
};
