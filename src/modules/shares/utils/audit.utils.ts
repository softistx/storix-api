import type { AuditActor, Auditor } from "@/core/audit";
import type { GrantDoc } from "../models";

export interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
  auditor: Auditor;
}

const record = (
  done: Done,
  action: string,
  node: { name: string; type: string },
  grant: GrantDoc,
  meta: Record<string, string>,
) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action,
    target: {
      type: node.type,
      id: grant.nodeId.toHexString(),
      name: node.name,
    },
    meta: {
      principalType: grant.principal.type,
      principalId: grant.principal.id.toHexString(),
      ...meta,
    },
  });

type Named = { name: string; type: string };

// The events of the grant writes, recorded after each has committed
// (`auditor.record` never throws).
export const recordShare = (done: Done, node: Named, grant: GrantDoc) =>
  record(done, "node.share", node, grant, { role: grant.role });

export const recordRegrant = (
  done: Done,
  node: Named,
  grant: GrantDoc,
  before: GrantDoc,
) =>
  record(done, "node.grant-change", node, grant, {
    from: before.role,
    to: grant.role,
  });

export const recordUnshare = (done: Done, node: Named, before: GrantDoc) =>
  record(done, "node.unshare", node, before, { role: before.role });
