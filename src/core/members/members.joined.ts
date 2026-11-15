import type { MemberDoc } from "./members.service";

// Who joined a workspace, as the modules that keep something per member are
// told: the workspace's creator, an invitee who accepted, anyone `joinWorkspace`
// adds.
export interface MemberJoined {
  workspaceId: string;
  memberId: string;
  accountId: string;
}

// A listener gets the workspace's own database (its module casts it to its
// handle, as a resolver does with `scope.mongo`) and who joined.
type Listener = (database: unknown, joined: MemberJoined) => Promise<unknown>;

const listeners = new Set<Listener>();

// Where a workspace's database is found: bound once by the server's wiring
// (src/config/tenancy.ts), because the kernel cannot reach the databases
// itself.
let databaseOf: ((workspaceId: string) => Promise<unknown>) | undefined;

export function bindMemberDatabases(
  next: (workspaceId: string) => Promise<unknown>,
): void {
  databaseOf = next;
}

// A business module (src/modules) asks to be told when a member joins, so that
// what it keeps per member (`nodes`: their root folder) exists from the start;
// the kernel cannot import it, so the module registers itself when its
// manifest loads. It returns the function that unregisters the listener.
export function onMemberJoined(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Tells every listener, after the membership was written (the core database
// committed, so the listeners' databases are another write). A listener that
// fails, or a workspace database that cannot be opened, is logged and never
// undoes the join nor stops the others: each module makes what it needs on
// first use too, so a missed set-up only costs that.
export async function memberJoined(member: MemberDoc): Promise<void> {
  const joined: MemberJoined = {
    workspaceId: member.workspaceId.toHexString(),
    memberId: member.id,
    accountId: member.accountId,
  };
  try {
    if (!databaseOf) throw new Error("the member databases are not bound");
    const database = await databaseOf(joined.workspaceId);
    for (const listener of listeners) {
      try {
        await listener(database, joined);
      } catch (error) {
        console.error(
          `storix-api: member ${joined.memberId} joined workspace ${joined.workspaceId} but a set-up failed:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error(
      `storix-api: member ${joined.memberId} joined workspace ${joined.workspaceId} but its database could not be opened:`,
      error,
    );
  }
}
