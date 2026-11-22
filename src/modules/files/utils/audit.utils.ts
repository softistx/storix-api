import { type AuditActor, type Auditor, memberActor } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";

export interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
  auditor: Auditor;
}

// The events of the files writes, recorded after each has committed
// (`auditor.record` never throws). The key is a storage address, not a secret,
// and stays out of them.
export const recordFileAdd = (done: Done, node: NodeDoc) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action: "file.add",
    target: { type: node.type, id: node.id, name: node.name },
    meta: {
      parentId: node.parentId?.toHexString() ?? "",
      mimeType: node.mimeType ?? "",
      size: node.size ?? 0,
    },
  });

// A copy: the target is the new node, `from` the node it was made from.
export const recordCopy = (done: Done, node: NodeDoc, from: string) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action: "node.copy",
    target: { type: node.type, id: node.id, name: node.name },
    meta: { from, parentId: node.parentId?.toHexString() ?? "" },
  });

// What changed, never the values: the metadata is the member's own data.
export const recordFileUpdate = (
  done: Done,
  node: NodeDoc,
  changed: readonly ("tags" | "meta")[],
) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action: "file.update",
    target: { type: node.type, id: node.id, name: node.name },
    meta: { changed: changed.join(",") },
  });

// A move of a picture's focal point: the target only, never the coordinates.
export const recordFileFocal = (done: Done, node: NodeDoc) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action: "file.focal",
    target: { type: node.type, id: node.id, name: node.name },
  });

// An upload `addFile` refused because the workspace is full. The target is the
// workspace and the name is the one asked for; the sizes stay out (the
// quota's figures are not for the audit log).
export const recordQuotaRefusal = (done: Done, name: string) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action: "quota.exceeded",
    target: { type: "WORKSPACE", id: done.workspaceId, name },
  });

// A version made, restored or deleted: the number (and, for a restore, the one
// it copied), never the key.
export const recordVersion = (
  done: Done,
  action: "file.version-add" | "file.version-restore" | "file.version-delete",
  node: NodeDoc,
  meta: { number: number; from?: number },
) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    ip: done.ip,
    action,
    target: { type: node.type, id: node.id, name: node.name },
    meta,
  });

// The context of an audited write: the workspace, the member who did it, the
// caller's address and the auditor.
export const doneBy = (
  ctx: { ip?: string | null | undefined; audit: Auditor },
  workspaceId: string,
  principal: { accountId: string; name: string },
): Done => ({
  workspaceId,
  actor: memberActor(principal),
  ip: ctx.ip,
  auditor: ctx.audit,
});
