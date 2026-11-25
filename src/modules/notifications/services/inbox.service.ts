import { InvalidCursorError, toObjectId, tryObjectId } from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import type { NotificationDoc, NotificationsMongo } from "../models";
import { notificationNotFound } from "../notifications.errors";

// The caller's inbox, newest first, one page at a time.
export async function listNotifications(
  mongo: NotificationsMongo,
  input: {
    accountId: string;
    first: number;
    after: string | null;
    unreadOnly: boolean;
  },
) {
  const filter = {
    accountId: input.accountId,
    ...(input.unreadOnly && { readAt: null }),
  };
  try {
    const [page, totalCount] = await Promise.all([
      mongo.db.notifications.paginateByCursor({
        filter,
        limit: input.first,
        after: input.after,
        orderBy: "createdAt",
        direction: "desc",
        scope: `notifications:${input.accountId}:${input.unreadOnly}`,
      }),
      mongo.db.notifications.count(filter),
    ]);
    return { items: page.items, endCursor: page.nextCursor, totalCount };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw fail("validation.errors.invalid-cursor", {
        status: 400,
        field: "after",
      });
    }
    throw error;
  }
}

// The account left a workspace: its inbox no longer holds that workspace's
// lines (the inbox spans the workspaces the account belongs to).
export const dropWorkspaceNotifications = (
  mongo: NotificationsMongo,
  accountId: string,
  workspaceId: string,
) =>
  mongo.db.notifications.deleteMany({
    accountId,
    workspaceId: toObjectId(workspaceId),
  });

export const unreadCount = (mongo: NotificationsMongo, accountId: string) =>
  mongo.db.notifications.count({ accountId, readAt: null });

// Marks one of the caller's notifications read; reading it again changes
// nothing. An id that is malformed, unknown or another account's is one 404.
export async function markRead(
  mongo: NotificationsMongo,
  input: { accountId: string; id: string },
): Promise<NotificationDoc> {
  const id = tryObjectId(input.id);
  const found =
    id &&
    (await mongo.db.notifications.findFirst({
      _id: id,
      accountId: input.accountId,
    }));
  if (!found) throw notificationNotFound();
  if (found.readAt !== null) return found;
  return mongo.db.notifications.update(found._id, { readAt: new Date() });
}

// Marks every unread notification of the caller read; how many it changed.
export async function markAllRead(
  mongo: NotificationsMongo,
  accountId: string,
): Promise<number> {
  const now = new Date();
  const done = await mongo.db.notifications.raw.updateMany(
    { accountId, readAt: null },
    { $set: { readAt: now, updatedAt: now } },
  );
  return done.modifiedCount;
}

export interface NewNotification {
  accountId: string;
  workspaceId: string;
  kind: "SHARED" | "ROLE_CHANGED" | "QUOTA_THRESHOLD";
  actorId?: string | null;
  nodeId?: string | null;
  nodeName?: string | null;
  role?: "VIEWER" | "EDITOR" | null;
  percent?: number | null;
}

// Records one notification per row, answering them in order.
export function recordNotifications(
  mongo: NotificationsMongo,
  rows: readonly NewNotification[],
): Promise<NotificationDoc[]> {
  return Promise.all(
    rows.map((row) =>
      mongo.db.notifications.create({
        accountId: row.accountId,
        workspaceId: toObjectId(row.workspaceId),
        kind: row.kind,
        actorId: row.actorId ?? null,
        nodeId: row.nodeId ? toObjectId(row.nodeId) : null,
        nodeName: row.nodeName ?? null,
        role: row.role ?? null,
        percent: row.percent ?? null,
      }),
    ),
  );
}
