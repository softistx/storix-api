import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { GrantDoc } from "../models";
import { grantView } from "./views.utils";

describe("grantView", () => {
  test("shows the ids as strings and keeps the role and the date", () => {
    const nodeId = new ObjectId();
    const principalId = new ObjectId();
    const createdAt = new Date("2026-11-24T00:00:00Z");
    const view = grantView({
      id: "g1",
      nodeId,
      principal: { type: "TEAM", id: principalId },
      role: "EDITOR",
      grantedBy: "acc",
      createdAt,
    } as unknown as GrantDoc);
    expect(view).toEqual({
      id: "g1",
      nodeId: nodeId.toHexString(),
      principal: { type: "TEAM", id: principalId.toHexString() },
      role: "EDITOR",
      grantedBy: "acc",
      createdAt,
    });
  });
});
