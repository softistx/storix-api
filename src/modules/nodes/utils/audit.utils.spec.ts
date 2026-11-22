import { describe, expect, test } from "bun:test";
import type { AuditActor, Auditor } from "@/core/audit";
import type { NodeDoc } from "../models";
import { recordFolderCreate, recordMove, recordRename } from "./audit.utils";

const node = (name: string, parent: string | null) =>
  ({
    type: "FOLDER",
    id: "n1",
    name,
    parentId: parent === null ? null : { toHexString: () => parent },
  }) as unknown as NodeDoc;

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
    done: { workspaceId: "w1", actor, ip: "1.2.3.4", auditor },
  };
}

describe("the nodes audit events", () => {
  test("a folder create names its parent", async () => {
    const { events, done } = scene();
    await recordFolderCreate(done, node("Photos", "p1"));
    expect(events[0]).toMatchObject({
      workspaceId: "w1",
      action: "node.folder-create",
      target: { type: "FOLDER", id: "n1", name: "Photos" },
      meta: { parentId: "p1" },
    });
  });

  test("a rename keeps the old and the new name", async () => {
    const { events, done } = scene();
    await recordRename(done, node("B", "p1"), node("A", "p1"));
    expect(events[0]).toMatchObject({
      action: "node.rename",
      meta: { from: "A", to: "B" },
    });
  });

  test("a move names where the node left and where it went", async () => {
    const { events, done } = scene();
    await recordMove(done, node("A", "p2"), "p1");
    expect(events[0]).toMatchObject({
      action: "node.move",
      meta: { from: "p1", to: "p2" },
    });
  });
});
