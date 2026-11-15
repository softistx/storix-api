import { type AuditActor, audit } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";

interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
}

// The events of the files writes, recorded after each has committed
// (`audit.record` never throws). The key is a storage address, not a secret,
// and stays out of them.
export const recordFileAdd = (done: Done, node: NodeDoc) =>
  audit.record({
    ...done,
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
  audit.record({
    ...done,
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
  audit.record({
    ...done,
    action: "file.update",
    target: { type: node.type, id: node.id, name: node.name },
    meta: { changed: changed.join(",") },
  });
