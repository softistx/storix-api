import { requireAccountSession } from "@/core/access";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { notificationsMongo } from "./models";
import {
  listNotifications,
  mailsOn,
  markAllRead,
  markRead,
  setMails,
  unreadCount,
} from "./services";
import { notificationView, pageInfoOf } from "./utils";

// The inbox is the caller's own, across workspaces: a session and no
// workspace header, and every read and write is filtered by the caller's
// account, so there is no other account's notification to refuse.
export const notificationsResolvers: Resolvers = {
  Query: {
    notifications: async (_, { first, after, unreadOnly }, ctx) => {
      const { accountId } = requireAccountSession(ctx);
      const page = await listNotifications(
        notificationsMongo(ctx.tenancy.core),
        {
          accountId,
          first,
          after: after ?? null,
          unreadOnly,
        },
      );
      return {
        nodes: page.items.map(notificationView),
        pageInfo: pageInfoOf(after ?? null, page.endCursor),
        totalCount: page.totalCount,
      };
    },
    unreadNotificationCount: (_, __, ctx) =>
      unreadCount(
        notificationsMongo(ctx.tenancy.core),
        requireAccountSession(ctx).accountId,
      ),
    mailPreferences: async (_, __, ctx) => ({
      mails: await mailsOn(
        notificationsMongo(ctx.tenancy.core),
        requireAccountSession(ctx).accountId,
      ),
    }),
  },
  Mutation: {
    markNotificationRead: async (_, { id }, ctx) =>
      notificationView(
        await markRead(notificationsMongo(ctx.tenancy.core), {
          accountId: requireAccountSession(ctx).accountId,
          id,
        }),
      ),
    markAllNotificationsRead: (_, __, ctx) =>
      markAllRead(
        notificationsMongo(ctx.tenancy.core),
        requireAccountSession(ctx).accountId,
      ),
    setMailPreferences: async (_, { mails }, ctx) => ({
      mails: await setMails(
        notificationsMongo(ctx.tenancy.core),
        requireAccountSession(ctx).accountId,
        mails,
      ),
    }),
  },
};
