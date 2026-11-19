import type { AuditActor, Auditor } from "../audit";
import type { MemberDoc } from "./members.service";
import type { WorkspaceRole } from "./roles";

interface Done {
  workspaceId: string;
  actor: AuditActor;
  ip: string | null | undefined;
  auditor: Auditor;
  member: MemberDoc;
  // The account's name, or null when it no longer exists.
  name: string | null;
}

const targetOf = ({ member, name }: Done) => ({
  type: "MEMBER",
  id: member.id,
  name,
});

// The events of the membership writes, recorded after each has committed
// (`auditor.record` never throws). `meta.accountId` names the person whose
// membership it was, since the target is the membership row.
export const recordRoleChange = (
  done: Done & { from: WorkspaceRole; to: WorkspaceRole },
) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    action: "member.role-change",
    target: targetOf(done),
    ip: done.ip,
    meta: { accountId: done.member.accountId, from: done.from, to: done.to },
  });

export const recordRemoval = (
  done: Done & { transferredTo?: string | undefined },
) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    action: "member.remove",
    target: targetOf(done),
    ip: done.ip,
    meta: {
      accountId: done.member.accountId,
      role: done.member.role,
      ...(done.transferredTo && { transferredTo: done.transferredTo }),
    },
  });

export const recordLeave = (done: Done) =>
  done.auditor.record({
    workspaceId: done.workspaceId,
    actor: done.actor,
    action: "member.leave",
    target: targetOf(done),
    ip: done.ip,
    meta: { accountId: done.member.accountId, role: done.member.role },
  });
