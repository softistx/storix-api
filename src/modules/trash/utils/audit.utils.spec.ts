import { describe, expect, test } from "bun:test";
import type { AuditActor, Auditor } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";
import { recordEmpty, recordTrash } from "./audit.utils";

const node = {
  type: "FILE",
  id: "n1",
  name: "a.txt",
  parentId: { toHexString: () => "p1" },
} as unknown as NodeDoc;

function scene() {
  const events: Record<string, unknown>[] = [];
  const auditor = {
    record: (event: Record<string, unknown>) => {
      events.push(event);
    },
  } as unknown as Auditor;
  const actor = { type: "MEMBER", id: "a1" } as unknown as AuditActor;
  return {
    events,
    done: { workspaceId: "w1", actor, ip: null, auditor },
  };
}

describe("the trash audit events", () => {
  test("a trash, restore or purge names the node and its parent", async () => {
    const { events, done } = scene();
    await recordTrash(done, "node.purge", node);
    expect(events[0]).toMatchObject({
      action: "node.purge",
      target: { type: "FILE", id: "n1", name: "a.txt" },
      meta: { parentId: "p1" },
    });
  });

  test("an emptied trash carries the counts", async () => {
    const { events, done } = scene();
    await recordEmpty(done, "acc", { entries: 2, nodes: 5 });
    expect(events[0]).toMatchObject({
      action: "trash.empty",
      target: { type: "TRASH", id: "acc" },
      meta: { entries: 2, nodes: 5 },
    });
  });
});
