import type { AuditDoc } from "../services/audit.service";

export const view = (event: AuditDoc) => ({
  id: event.id,
  at: event.at,
  actor: event.actor,
  action: event.action,
  target: event.target,
  ipHash: event.ipHash,
  meta: event.meta,
});
