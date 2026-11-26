import { describe, expect, test } from "bun:test";
import { toEvent } from "./event.utils";

const actor = { type: "MEMBER", id: "a1", label: "Ada" } as const;

describe("toEvent", () => {
  test("picks the workspace, the actor and the address of a done", () => {
    const done = { workspaceId: "w1", actor, ip: "1.2.3.4", auditor: {} };
    expect(toEvent(done)).toEqual({ workspaceId: "w1", actor, ip: "1.2.3.4" });
  });

  test("keeps a null or missing address as given", () => {
    expect(toEvent({ workspaceId: "w1", actor, ip: null }).ip).toBeNull();
    expect(
      toEvent({ workspaceId: "w1", actor, ip: undefined }).ip,
    ).toBeUndefined();
  });
});
