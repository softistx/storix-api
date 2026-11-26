import { type AuditActor, type Auditor, toEvent } from "@/core/audit";
import type { TeamDoc } from "../models";

interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
  auditor: Auditor;
}

const targetOf = (team: TeamDoc) => ({
  type: "TEAM",
  id: team.id,
  name: team.name,
});

// The events of the team writes, recorded after each has committed
// (`auditor.record` never throws).
export const recordTeamCreate = (done: Done, team: TeamDoc) =>
  done.auditor.record({
    ...toEvent(done),
    action: "team.create",
    target: targetOf(team),
  });

export const recordTeamRename = (done: Done, team: TeamDoc, before: TeamDoc) =>
  done.auditor.record({
    ...toEvent(done),
    action: "team.rename",
    target: targetOf(team),
    meta: { from: before.name, to: team.name },
  });

// `meta` counts the people who joined and left; the ids are in the team.
export const recordTeamMembers = (
  done: Done,
  team: TeamDoc,
  before: TeamDoc,
) => {
  const was = new Set(before.memberIds.map((id) => id.toHexString()));
  const is = new Set(team.memberIds.map((id) => id.toHexString()));
  return done.auditor.record({
    ...toEvent(done),
    action: "team.set-members",
    target: targetOf(team),
    meta: {
      count: is.size,
      added: [...is].filter((id) => !was.has(id)).length,
      removed: [...was].filter((id) => !is.has(id)).length,
    },
  });
};

export const recordTeamDelete = (done: Done, team: TeamDoc) =>
  done.auditor.record({
    ...toEvent(done),
    action: "team.delete",
    target: targetOf(team),
  });
