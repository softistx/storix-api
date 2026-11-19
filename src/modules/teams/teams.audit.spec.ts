import { expect, test } from "bun:test";
import type { AuditEventInput, Auditor } from "@/core/audit";
import { recordTeamCreate } from "./teams.audit";
import type { TeamDoc } from "./teams.service";

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
