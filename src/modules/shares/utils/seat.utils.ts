import { membersMongo, type Seat, seatOf } from "@/core/members";

// The caller's seat in the request's workspace: its account and its member
// row. The guard has proved the membership, so a missing row is a member who
// left between the guard and here.
export async function callerSeat(
  scope: { readonly core: unknown; readonly tenant: { readonly id: string } },
  accountId: string,
): Promise<Seat> {
  const seat = await seatOf(
    membersMongo(scope.core),
    scope.tenant.id,
    accountId,
  );
  if (!seat) throw new Error("the caller is not a member of the workspace");
  return seat;
}
