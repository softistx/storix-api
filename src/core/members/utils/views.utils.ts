import type { Account } from "../../identity";
import type { MemberDoc } from "../services";

export const memberView = (
  member: MemberDoc,
  account: Account | undefined,
) => ({
  id: member.id,
  accountId: member.accountId,
  name: account?.name ?? null,
  email: account?.email ?? null,
  role: member.role,
  joinedAt: member.createdAt,
});
