import type { AuditActor } from "../services";

// The part of an audit event every audited write shares: the workspace, who
// did it and from which address. A module's `Done` carries these fields beside
// its own, and `...toEvent(done)` puts them on the event, so the pick is
// written once.
export const toEvent = (done: {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
}) => ({ workspaceId: done.workspaceId, actor: done.actor, ip: done.ip });
