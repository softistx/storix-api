import { type Auditor, memberActor } from "@/core/audit";
import { membersMongo } from "@/core/members";
import { teamsMongo } from "../models";

// The request's scope as the teams code reads it.
export interface Scope {
  readonly core: unknown;
  readonly tenant: { readonly id: string };
}

// The module's handles on the request's databases (the scope's, typed by the
// registry; see src/core/access/ports.ts).
export const workspaceDb = (scope: { readonly mongo: unknown }) =>
  teamsMongo(scope.mongo);
export const coreDb = (scope: { readonly core: unknown }) =>
  membersMongo(scope.core);

// Who and where an audit event of this request is about.
export const auditOf = (
  ctx: { ip?: string | null | undefined; audit: Auditor },
  scope: Scope,
  principal: { accountId: string; name: string },
) => ({
  workspaceId: scope.tenant.id,
  actor: memberActor(principal),
  ip: ctx.ip,
  auditor: ctx.audit,
});
