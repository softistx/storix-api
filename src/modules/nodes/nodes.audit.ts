import { type AuditActor, audit } from "@/core/audit";
import type { NodeDoc } from "./nodes.service";

interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
}

const targetOf = (node: NodeDoc) => ({
  type: node.type,
  id: node.id,
  name: node.name,
});

// The events of the tree writes, recorded after each has committed
// (`audit.record` never throws).
export const recordFolderCreate = (done: Done, node: NodeDoc) =>
  audit.record({
    ...done,
    action: "node.folder-create",
    target: targetOf(node),
    meta: { parentId: node.parentId?.toHexString() ?? "" },
  });

export const recordRename = (done: Done, node: NodeDoc, before: NodeDoc) =>
  audit.record({
    ...done,
    action: "node.rename",
    target: targetOf(node),
    meta: { from: before.name, to: node.name },
  });

export const recordMove = (done: Done, node: NodeDoc, from: string | null) =>
  audit.record({
    ...done,
    action: "node.move",
    target: targetOf(node),
    meta: { from: from ?? "", to: node.parentId?.toHexString() ?? "" },
  });
