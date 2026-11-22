import { describe, expect, test } from "bun:test";
import { toObjectId } from "@softistx/mongo";
import type { AuditActor, AuditEventInput, Auditor } from "@/core/audit";
import type { TeamDoc } from "../models";
import {
  recordTeamCreate,
  recordTeamMembers,
  recordTeamRename,
} from "./audit.utils";

const recorded: Record<string, unknown>[] = [];
const done = {
  workspaceId: "w1",
  actor: {} as AuditActor,
  ip: null,
  auditor: {
    record: (event: Record<string, unknown>) => recorded.push(event),
  } as unknown as Auditor,
};
const [a, b, c] = ["a", "b", "c"].map((x) => toObjectId(x.repeat(24))) as [
  ReturnType<typeof toObjectId>,
  ReturnType<typeof toObjectId>,
  ReturnType<typeof toObjectId>,
];
const teamOf = (name: string, memberIds: ReturnType<typeof toObjectId>[]) =>
  ({ id: "t1", name, memberIds }) as unknown as TeamDoc;

describe("team audit events", () => {
  test("a rename says the old and the new name", async () => {
    recorded.length = 0;
    await recordTeamRename(done, teamOf("B", []), teamOf("A", []));
    expect(recorded[0]).toMatchObject({
      action: "team.rename",
      meta: { from: "A", to: "B" },
    });
  });

  test("a member change counts who joined and who left", async () => {
    recorded.length = 0;
    await recordTeamMembers(done, teamOf("A", [b, c]), teamOf("A", [a, b]));
    expect(recorded[0]).toMatchObject({
      action: "team.set-members",
      meta: { count: 2, added: 1, removed: 1 },
    });
  });

  test("the event an auditor receives holds the event's fields only, never the auditor", async () => {
    const seen: AuditEventInput[] = [];
    const auditor: Auditor = {
      record: async (event) => {
        seen.push(event);
      },
    };
    await recordTeamCreate(
      {
        workspaceId: "w1",
        actor: { type: "MEMBER", id: "a1", label: "Ada" },
        ip: "203.0.113.7",
        auditor,
      },
      { id: "t1", name: "Design" } as unknown as TeamDoc,
    );
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0] as object)).not.toContain("auditor");
    expect(seen[0]).toMatchObject({ workspaceId: "w1", action: "team.create" });
  });
});
