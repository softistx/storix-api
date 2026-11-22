import { type Auditor, memberActor } from "@/core/audit";

// Who did a write, for the audit events recorded after it commits.
export const doneBy = (
  ctx: { ip?: string | null | undefined; audit: Auditor },
  workspaceId: string,
  principal: { accountId: string; name: string },
) => ({
  workspaceId,
  actor: memberActor(principal),
  ip: ctx.ip,
  auditor: ctx.audit,
});
