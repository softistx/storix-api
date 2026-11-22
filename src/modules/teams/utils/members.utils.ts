import { activeMemberIds } from "@/core/members";
import { memberUnknown } from "../teams.errors";
import { coreDb, type Scope } from "./session.utils";

// The ids without repeats; refuses (`member-unknown`) an id of a member who
// left, of another workspace or malformed.
export async function knownMembers(
  scope: Scope,
  memberIds: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(memberIds)];
  const known = await activeMemberIds(coreDb(scope), scope.tenant.id, wanted);
  if (wanted.some((memberId) => !known.has(memberId))) throw memberUnknown();
  return wanted;
}
