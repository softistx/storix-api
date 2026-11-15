import { type AuditActor, audit } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";

// The event of a file recorded, after it has committed (`audit.record` never
// throws). The key is a storage address, not a secret, and stays out of it.
export const recordFileAdd = (
  done: {
    workspaceId: string;
    actor: AuditActor;
    ip: string | null | undefined;
  },
  node: NodeDoc,
) =>
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
