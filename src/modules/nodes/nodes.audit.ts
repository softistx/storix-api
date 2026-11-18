import type { AuditActor, Auditor } from "@/core/audit";
import type { NodeDoc } from "./nodes.service";

interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
  auditor: Auditor;
}

const targetOf = (node: NodeDoc) => ({
  type: node.type,
  id: node.id,
  name: node.name,
});

// The events of the tree writes, recorded after each has committed
// (`auditor.record` never throws).
export const recordFolderCreate = (done: Done, node: NodeDoc) =>
  done.auditor.record({
    ...done,
    action: "node.folder-create",
    target: targetOf(node),
    meta: { parentId: node.parentId?.toHexString() ?? "" },
  });

export const recordRename = (done: Done, node: NodeDoc, before: NodeDoc) =>
  done.auditor.record({
    ...done,
    action: "node.rename",
    target: targetOf(node),
    meta: { from: before.name, to: node.name },
  });

export const recordMove = (done: Done, node: NodeDoc, from: string | null) =>
  done.auditor.record({
    ...done,
    action: "node.move",
    target: targetOf(node),
    meta: { from: from ?? "", to: node.parentId?.toHexString() ?? "" },
  });
