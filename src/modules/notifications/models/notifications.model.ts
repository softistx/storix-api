import { defineCollection, id, objectId } from "@softistx/mongo";
import { z } from "zod";

export const notificationKinds = [
  "SHARED",
  "ROLE_CHANGED",
  "QUOTA_THRESHOLD",
] as const;

// One line of an account's inbox, in the core database (an inbox is the
// account's, across its workspaces). `actorId` is the account that caused it
// (null for a quota threshold); `nodeId`, `nodeName` and `role` describe a
// share, `percent` a quota threshold (80 or 100). The node's name is kept as it
// was when the notification was made. `readAt` is null while unread.
export const notifications = defineCollection({
  name: "notifications",
  schema: z.object({
    _id: id(),
    accountId: z.string().min(1),
    workspaceId: objectId(),
    kind: z.enum(notificationKinds),
    actorId: z.string().nullable().default(null),
    nodeId: objectId().nullable().default(null),
    nodeName: z.string().nullable().default(null),
    role: z.enum(["VIEWER", "EDITOR"]).nullable().default(null),
    percent: z.number().int().nullable().default(null),
    readAt: z.date().nullable().default(null),
  }),
  timestamps: true,
  indexes: [
    { key: { accountId: 1, createdAt: -1 }, name: "notifications_inbox" },
    { key: { accountId: 1, readAt: 1 }, name: "notifications_unread" },
  ],
});

// Whether an account wants the mail of its notifications. No row means yes.
export const mailPreferences = defineCollection({
  name: "mailPreferences",
  schema: z.object({
    _id: id(),
    accountId: z.string().min(1),
    mails: z.boolean(),
  }),
  timestamps: true,
  indexes: [
    {
      key: { accountId: 1 },
      unique: true,
      name: "mailPreferences_account_unique",
    },
  ],
});

// The highest quota threshold a workspace has been told about (0, 80 or 100):
// a notification is made once per crossing, and the mark is lowered when the
// usage falls back under the threshold, so a later crossing tells again.
export const quotaMarks = defineCollection({
  name: "quotaMarks",
  schema: z.object({
    _id: id(),
    workspaceId: objectId(),
    level: z.number().int(),
  }),
  timestamps: true,
  indexes: [
    {
      key: { workspaceId: 1 },
      unique: true,
      name: "quotaMarks_workspace_unique",
    },
  ],
});
