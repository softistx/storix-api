import type { WorkspaceScope } from "../access";
import type { MemberDoc } from "./members.service";

// Who left a workspace, as the modules that keep member ids of their own are
// told: `removeMember` and `leaveWorkspace` answer it once the membership has
// ended.
export interface MemberRemoval {
  workspaceId: string;
  memberId: string;
  accountId: string;
}

// What a leaver hands over, for the modules that own their data
// (`removeMember(transferTo:)`).
export interface MemberHandover {
  workspaceId: string;
  from: { memberId: string; accountId: string; name: string | null };
  to: { memberId: string; accountId: string };
}

// Answers whether it moved something.
type HandoverListener = (
  scope: WorkspaceScope,
  handover: MemberHandover,
) => Promise<boolean>;

const handovers = new Set<HandoverListener>();

// A business module that owns what a member made asks to receive it when
// `removeMember` names a receiver. Unlike `onMemberRemoved`, it runs before the
// removal commits and its failure fails the call: the membership stays.
export function onMemberHandover(listener: HandoverListener): () => void {
  handovers.add(listener);
  return () => {
    handovers.delete(listener);
  };
}

// Runs the handovers; answers whether any moved something.
export async function handOver(
  scope: WorkspaceScope,
  handover: MemberHandover,
): Promise<boolean> {
  let moved = false;
  for (const listener of handovers) {
    if (await listener(scope, handover)) moved = true;
  }
  return moved;
}

type Listener = (
  scope: WorkspaceScope,
  removal: MemberRemoval,
) => Promise<unknown>;

const listeners = new Set<Listener>();

// A business module (src/modules) asks to be told when a member leaves, so that
// its own data stops naming them: the kernel cannot import it (the layers of
// test/boundaries.spec.ts), so the module registers itself when its manifest
// loads. `teams` takes the member out of its teams.
// It returns the function that unregisters the listener.
export function onMemberRemoved(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Tells every listener, after the membership ended (the core database
// committed, so the listeners' databases are another write). A listener that
// fails is logged and never undoes the removal nor stops the others: each
// module's reads ignore a member who is gone, so a missed clean-up only leaves
// an id that no longer shows.
export async function memberRemoved(
  scope: WorkspaceScope,
  member: MemberDoc,
): Promise<void> {
  const removal: MemberRemoval = {
    workspaceId: scope.tenant.id,
    memberId: member.id,
    accountId: member.accountId,
  };
  for (const listener of listeners) {
    try {
      await listener(scope, removal);
    } catch (error) {
      console.error(
        `storix-api: member ${removal.memberId} left workspace ${removal.workspaceId} but a clean-up failed:`,
        error,
      );
    }
  }
}
