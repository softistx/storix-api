import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { NotificationDoc } from "../models";
import { notificationView, pageInfoOf } from "./views.utils";

describe("the views of the inbox", () => {
  test("a notification shows its ids as strings", () => {
    const workspaceId = new ObjectId();
    const nodeId = new ObjectId();
    const doc = {
      id: "n1",
      kind: "SHARED",
      workspaceId,
      actorId: "a1",
      nodeId,
      nodeName: "Docs",
      role: "EDITOR",
      percent: null,
      readAt: null,
      createdAt: new Date(0),
    } as unknown as NotificationDoc;
    expect(notificationView(doc)).toMatchObject({
      id: "n1",
      workspaceId: workspaceId.toHexString(),
      nodeId: nodeId.toHexString(),
      percent: null,
    });
  });

  test("a quota notification has no node", () => {
    const doc = {
      id: "n2",
      workspaceId: new ObjectId(),
      nodeId: null,
    } as unknown as NotificationDoc;
    expect(notificationView(doc).nodeId).toBeNull();
  });

  test("pageInfo follows the cursors", () => {
    expect(pageInfoOf(null, "c1")).toEqual({
      startCursor: null,
      endCursor: "c1",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(pageInfoOf("c1", null)).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
});
