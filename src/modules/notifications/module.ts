import { defineModule } from "@softistx/alxia-modules";
import { mailPreferences, notifications, quotaMarks } from "./models";
import { notifications as codes } from "./notifications.errors";
import typeDefs from "./notifications.graphqls" with { type: "text" };
import { notificationsResolvers } from "./notifications.resolver";

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
