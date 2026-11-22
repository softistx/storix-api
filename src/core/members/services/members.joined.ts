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
export type JoinListener = (
  database: unknown,
  joined: MemberJoined,
) => Promise<unknown>;

// What `memberJoined` needs, handed in by the app's wiring (src/config/wiring.ts):
// the kernel cannot reach the workspaces' databases, nor import the business
// modules that keep something per member (`nodes`: their root folder).
export interface MemberJoinWiring {
  databaseOf: (workspaceId: string) => Promise<unknown>;
  onJoined: readonly JoinListener[];
}

// Tells every listener, after the membership was written (the core database
// committed, so the listeners' databases are another write). A listener that
// fails, or a workspace database that cannot be opened, is logged and never
// undoes the join nor stops the others: each module makes what it needs on
// first use too, so a missed set-up only costs that.
export async function memberJoined(
  wiring: MemberJoinWiring,
  member: MemberDoc,
): Promise<void> {
  const joined: MemberJoined = {
    workspaceId: member.workspaceId.toHexString(),
    memberId: member.id,
    accountId: member.accountId,
  };
  try {
    const database = await wiring.databaseOf(joined.workspaceId);
    for (const listener of wiring.onJoined) {
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
