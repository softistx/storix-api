import type { NotificationDoc } from "../models";

// What `Notification` resolves to.
export const notificationView = (doc: NotificationDoc) => ({
  id: doc.id,
  kind: doc.kind,
  workspaceId: doc.workspaceId.toHexString(),
  actorId: doc.actorId,
  nodeId: doc.nodeId ? doc.nodeId.toHexString() : null,
  nodeName: doc.nodeName,
  role: doc.role,
  percent: doc.percent,
  readAt: doc.readAt,
  createdAt: doc.createdAt,
});

// The cursor connection's `pageInfo`: the cursor of the next page, when there
// is one.
export const pageInfoOf = (after: string | null, endCursor: string | null) => ({
  startCursor: after,
  endCursor,
  hasNextPage: endCursor !== null,
  hasPreviousPage: after !== null,
});
