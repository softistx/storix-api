import { type AuditActor, type Auditor, toEvent } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";

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

// The events of the trash writes, recorded after each has committed
// (`auditor.record` never throws): one per top node trashed, restored or purged,
// and one for an emptied trash.
export const recordTrash = (
  done: Done,
  action: "node.trash" | "node.restore" | "node.purge",
  node: NodeDoc,
) =>
  done.auditor.record({
    ...toEvent(done),
    action,
    target: targetOf(node),
    meta: { parentId: node.parentId?.toHexString() ?? "" },
  });

export const recordEmpty = (
  done: Done,
  accountId: string,
  counts: { entries: number; nodes: number },
) =>
  done.auditor.record({
    ...toEvent(done),
    action: "trash.empty",
    target: { type: "TRASH", id: accountId, name: "trash" },
    meta: counts,
  });
