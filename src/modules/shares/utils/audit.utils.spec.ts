import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { GrantDoc } from "../models";
import { recordRegrant, recordShare, recordUnshare } from "./audit.utils";

const grant = (role: "VIEWER" | "EDITOR") =>
  ({
    nodeId: new ObjectId(),
    principal: { type: "MEMBER", id: new ObjectId() },
    role,
  }) as unknown as GrantDoc;

function done() {
  const events: Record<string, unknown>[] = [];
  const auditor = {
    record: (event: Record<string, unknown>) => events.push(event),
  };
  return {
    events,
    done: {
      workspaceId: "w1",
      actor: { type: "USER", id: "a1" },
      ip: "1.2.3.4",
      auditor,
    } as never,
  };
}

describe("the events of the grant writes", () => {
  test("a share names the node, the principal and the role", async () => {
    const { events, done: d } = done();
    const g = grant("VIEWER");
    await recordShare(d, { name: "Docs", type: "FOLDER" }, g);
    expect(events[0]).toMatchObject({
      action: "node.share",
      workspaceId: "w1",
      target: { type: "FOLDER", id: g.nodeId.toHexString(), name: "Docs" },
      meta: { principalType: "MEMBER", role: "VIEWER" },
    });
  });

  test("a change keeps the role it left and the one it took", async () => {
    const { events, done: d } = done();
    await recordRegrant(
      d,
      { name: "a", type: "FILE" },
      grant("EDITOR"),
      grant("VIEWER"),
    );
    expect(events[0]).toMatchObject({
      action: "node.grant-change",
      meta: { from: "VIEWER", to: "EDITOR" },
    });
  });

  test("an unshare keeps the role the principal had", async () => {
    const { events, done: d } = done();
    await recordUnshare(d, { name: "a", type: "FILE" }, grant("EDITOR"));
    expect(events[0]).toMatchObject({
      action: "node.unshare",
      meta: { role: "EDITOR" },
    });
  });
});
