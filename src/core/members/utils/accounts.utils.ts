import type { Context } from "@/http/context";
import type { Account } from "../../identity";
import type { MemberDoc } from "../services";

// One call for the accounts of a page (the port's DataLoader source).
export async function accountsOf(ctx: Context, members: readonly MemberDoc[]) {
  const accounts = await ctx.identity.accounts.byIds(
    members.map((member) => member.accountId),
  );
  return new Map(accounts.map((account) => [account.accountId, account]));
}

// The name of a member's account for the audit log, null when the account
// cannot be read: the removal has committed, so a failed lookup must not fail
// the request.
export async function accountOf(
  ctx: Context,
  member: MemberDoc,
): Promise<Account | undefined> {
  try {
    return (await accountsOf(ctx, [member])).get(member.accountId);
  } catch {
    return undefined;
  }
}

export async function nameOf(
  ctx: Context,
  member: MemberDoc,
): Promise<string | null> {
  return (await accountOf(ctx, member))?.name ?? null;
}
