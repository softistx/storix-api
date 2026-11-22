import { describe, expect, test } from "bun:test";
import { toObjectId } from "@softistx/mongo";
import type { TeamDoc } from "../models";
import { teamView } from "./views.utils";

const a = toObjectId("a".repeat(24));
const b = toObjectId("b".repeat(24));
const team = {
  id: "t1",
  name: "Design",
  memberIds: [a, b],
  createdAt: new Date(0),
  updatedAt: new Date(1),
} as unknown as TeamDoc;

describe("teamView", () => {
  test("keeps the current members and counts them", () => {
    const view = teamView(team, new Set([a.toHexString()]));
    expect(view.memberIds).toEqual([a.toHexString()]);
    expect(view.memberCount).toBe(1);
    expect(view.name).toBe("Design");
  });

  test("shows no member when none is current", () => {
    expect(teamView(team, new Set()).memberCount).toBe(0);
  });
});
