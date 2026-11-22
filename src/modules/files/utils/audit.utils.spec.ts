import { describe, expect, test } from "bun:test";
import type { AuditActor, Auditor } from "@/core/audit";
import type { NodeDoc } from "@/modules/nodes/public";
import {
  doneBy,
  recordCopy,
  recordFileAdd,
  recordFileFocal,
  recordFileUpdate,
  recordQuotaRefusal,
  recordVersion,
} from "./audit.utils";

const node = {
  type: "FILE",
  id: "n1",
  name: "a.txt",
  parentId: { toHexString: () => "p1" },
  mimeType: "text/plain",
  size: 3,
} as unknown as NodeDoc;

function done() {
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

describe("the files audit events", () => {
  test("an add names the parent, type and size, never the key", async () => {
    const { events, done: d } = done();
    await recordFileAdd(d, node);
    expect(events[0]).toMatchObject({
      action: "file.add",
      workspaceId: "w1",
      target: { type: "FILE", id: "n1", name: "a.txt" },
      meta: { parentId: "p1", mimeType: "text/plain", size: 3 },
    });
  });

  test("an update lists what changed, a focal move names no coordinate", async () => {
    const { events, done: d } = done();
    await recordFileUpdate(d, node, ["tags", "meta"]);
    await recordFileFocal(d, node);
    expect(events[0]).toMatchObject({
      action: "file.update",
      meta: { changed: "tags,meta" },
    });
    expect(events[1]).toMatchObject({ action: "file.focal" });
    expect(events[1]?.["meta"]).toBeUndefined();
  });

  test("a quota refusal targets the workspace with the name asked for", async () => {
    const { events, done: d } = done();
    await recordQuotaRefusal(d, "big.bin");
    expect(events[0]).toMatchObject({
      action: "quota.exceeded",
      target: { type: "WORKSPACE", id: "w1", name: "big.bin" },
    });
  });

  test("a version event carries its number and a copy its source", async () => {
    const { events, done: d } = done();
    await recordVersion(d, "file.version-restore", node, {
      number: 3,
      from: 1,
    });
    await recordCopy(d, node, "src1");
    expect(events[0]).toMatchObject({
      action: "file.version-restore",
      meta: { number: 3, from: 1 },
    });
    expect(events[1]).toMatchObject({ action: "file.copy" });
  });
});

describe("doneBy", () => {
  test("gathers the workspace, the member, the address and the auditor", () => {
    const audit = { record: () => undefined } as unknown as Auditor;
    const result = doneBy({ ip: "9.9.9.9", audit }, "w1", {
      accountId: "a1",
      name: "Ann",
    });
    expect(result.workspaceId).toBe("w1");
    expect(result.ip).toBe("9.9.9.9");
    expect(result.auditor).toBe(audit);
    expect(result.actor).toBeDefined();
  });
});
