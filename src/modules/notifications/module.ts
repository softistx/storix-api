import { defineModule } from "@softistx/alxia-modules";
import type { RemovalListener } from "@/core/members";
import {
  mailPreferences,
  notifications,
  notificationsMongo,
  quotaMarks,
} from "./models";
import { notifications as codes } from "./notifications.errors";
import typeDefs from "./notifications.graphqls" with { type: "text" };
import { notificationsResolvers } from "./notifications.resolver";
import { dropWorkspaceNotifications } from "./services";

// The inbox of an account and the mails of its notifications. The
// collections live in the core database: an inbox spans the account's
// workspaces. The events (a share, a role change, a quota threshold) arrive
// through the `Notify` port of `src/core/notify`, which the app builds from
// this module's `Notifier`; nothing imports this module but the app.
export const notificationsModule = defineModule({
  name: "notifications",
  dependsOn: ["identity", "members", "teams", "workspaces"],
  coreCollections: { notifications, mailPreferences, quotaMarks },
  codes,
  typeDefs: [typeDefs],
  resolvers: notificationsResolvers,
});

// The app's wiring (src/config/wiring.ts) hands it to the members kernel: an
// account that left a workspace keeps none of that workspace's lines.
export const notificationsOnRemoved: RemovalListener = (scope, removal) =>
  dropWorkspaceNotifications(
    notificationsMongo(scope.core),
    removal.accountId,
    removal.workspaceId,
  );
