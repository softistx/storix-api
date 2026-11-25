// The notification port: what the modules that cause an event (shares, files)
// tell the app, without importing the module that records and mails it
// (src/modules/notifications). The app builds the notifier and hands it to the
// requests (`ctx.notify`, src/http/context.ts), as it does the audit log.
// Plain infrastructure: no module of its own.
import type { WorkspaceScope } from "../access";

// A node shared (`shared`) or a grant's role changed (`roleChanged`): who did
// it, the node, and the principal the grant is for. `principal.id` is a
// `members` row id or a team id, as in the grants.
export interface ShareEvent {
  scope: WorkspaceScope;
  actorId: string;
  node: { id: string; name: string };
  principal: { type: "MEMBER" | "TEAM"; id: string };
  role: "VIEWER" | "EDITOR";
}

// The workspace's storage grew: the notifier looks at the quota.
export interface UsageEvent {
  scope: WorkspaceScope;
}

// Every method answers once the notifications are recorded and the mails are
// queued; none ever throws: an event that cannot be notified is logged, and the
// request that caused it stands.
export interface Notify {
  shared(event: ShareEvent): Promise<void>;
  roleChanged(event: ShareEvent): Promise<void>;
  usage(event: UsageEvent): Promise<void>;
}

// The notifier of an app that notifies nobody (specs that do not care).
export const noNotify: Notify = {
  shared: async () => undefined,
  roleChanged: async () => undefined,
  usage: async () => undefined,
};
