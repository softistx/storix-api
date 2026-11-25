import { toObjectId } from "@softistx/mongo";
import type { MembersMongo } from "./members.service";

// Who is asking, for the reads that depend on more than the account: the
// account (what a node's `ownerId` holds) and the member row of the
// workspace (what a grant on a member and a team's `memberIds` hold).
export interface Seat {
  accountId: string;
  memberId: string;
}

// What a service takes as the caller: a seat, or a bare account id for the
// callers that have no member to speak of (a sweep, a retention job, a spec of
// the owner's own tree). A bare account reaches what it owns and the grants
// that name no member or team: none.
export type Who = string | Seat;

export const accountOf = (who: Who): string =>
  typeof who === "string" ? who : who.accountId;

export const memberOf = (who: Who): string | null =>
  typeof who === "string" ? null : who.memberId;

// The seat of an account in a workspace: its current member row's id, or null
// for an account that is not (or no longer) a member.
export async function seatOf(
  mongo: MembersMongo,
  workspaceId: string,
  accountId: string,
): Promise<Seat | null> {
  const member = await mongo.db.members.findFirst({
    workspaceId: toObjectId(workspaceId),
    accountId,
    removedAt: null,
  });
  return member ? { accountId, memberId: member.id } : null;
}
