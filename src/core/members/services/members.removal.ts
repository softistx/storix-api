import type { WorkspaceScope } from "../../access";
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

// Answers whether it moved something. It runs before the removal commits and
// its failure fails the call: the membership stays.
export type HandoverListener = (
  scope: WorkspaceScope,
  handover: MemberHandover,
) => Promise<boolean>;

// Told once the membership has ended, so that a module's own data stops naming
// the member.
export type RemovalListener = (
  scope: WorkspaceScope,
  removal: MemberRemoval,
) => Promise<unknown>;

// What a removal tells the business modules that own data per member, handed in
// by the app's wiring (src/config/wiring.ts): the kernel cannot import them
// (the layers of test/boundaries.spec.ts). `nodes` receives a leaver's tree
// (`onHandover`), `shares` ends the grants that name the member
// (`onRemoving`: it runs before the removal commits and its failure fails the
// call, as a handover does, since a grant that outlives its member is an access
// hole), `teams` takes the member out of its teams (`onRemoved`, best effort).
export interface MemberRemovalWiring {
  onHandover: readonly HandoverListener[];
  onRemoving: readonly RemovalListener[];
  onRemoved: readonly RemovalListener[];
}

export const removalOf = (
  scope: WorkspaceScope,
  member: MemberDoc,
): MemberRemoval => ({
  workspaceId: scope.tenant.id,
  memberId: member.id,
  accountId: member.accountId,
});

// Runs the listeners that must succeed for the removal to happen (just before
// the removal commits, not rolled back with it: callers run it as their last
// step): the first that throws
// fails the call and the membership stays.
export async function removing(
  wiring: MemberRemovalWiring,
  scope: WorkspaceScope,
  member: MemberDoc,
): Promise<void> {
  const removal = removalOf(scope, member);
  for (const listener of wiring.onRemoving) await listener(scope, removal);
}

// Runs the handovers; answers whether any moved something.
export async function handOver(
  wiring: MemberRemovalWiring,
  scope: WorkspaceScope,
  handover: MemberHandover,
): Promise<boolean> {
  let moved = false;
  for (const listener of wiring.onHandover) {
    if (await listener(scope, handover)) moved = true;
  }
  return moved;
}

// Tells every listener, after the membership ended (the core database
// committed, so the listeners' databases are another write). A listener that
// fails is logged and never undoes the removal nor stops the others: each
// module's reads ignore a member who is gone, so a missed clean-up only leaves
// an id that no longer shows.
export async function memberRemoved(
  wiring: MemberRemovalWiring,
  scope: WorkspaceScope,
  member: MemberDoc,
): Promise<void> {
  const removal = removalOf(scope, member);
  for (const listener of wiring.onRemoved) {
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
