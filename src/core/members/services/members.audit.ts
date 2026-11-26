import { type AuditActor, type Auditor, toEvent } from "../../audit";
import type { WorkspaceRole } from "../roles";
import type { MemberDoc } from "./members.service";

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
    ...toEvent(done),
    action: "member.role-change",
    target: targetOf(done),
    meta: { accountId: done.member.accountId, from: done.from, to: done.to },
  });

export const recordRemoval = (
  done: Done & { transferredTo?: string | undefined },
) =>
  done.auditor.record({
    ...toEvent(done),
    action: "member.remove",
    target: targetOf(done),
    meta: {
      accountId: done.member.accountId,
      role: done.member.role,
      ...(done.transferredTo && { transferredTo: done.transferredTo }),
    },
  });

export const recordLeave = (done: Done) =>
  done.auditor.record({
    ...toEvent(done),
    action: "member.leave",
    target: targetOf(done),
    meta: { accountId: done.member.accountId, role: done.member.role },
  });
