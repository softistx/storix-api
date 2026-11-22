import type { ModuleCoreHandle } from "@softistx/alxia-modules";
import type { Membership } from "@softistx/alxia-tenancy";
import { toObjectId, tryObjectId } from "@softistx/mongo";
import type { core } from "@/config/db";
import { forbidden, invalidInput } from "@/i18n/fail";
import { lastOwner, memberNotFound } from "../members.errors";
import type { WorkspaceRole } from "../roles";

// The module's handle on the core database: its own collection only.
export type MembersMongo = ModuleCoreHandle<"members", typeof core>;

export type MemberDoc = Awaited<
  ReturnType<MembersMongo["db"]["members"]["getById"]>
>;

// What a membership says to `@softistx/alxia-tenancy`: the member's role, or null when
// the account is not (or no longer) a member. A key is never asked: the
// guards refuse it before the scope is read.
export const membershipOf =
  (mongo: MembersMongo): Membership<WorkspaceRole> =>
  async (workspaceId, accountId) => {
    const id = tryObjectId(workspaceId);
    if (!id) return null;
    const member = await mongo.db.members.findFirst({
      workspaceId: id,
      accountId,
      removedAt: null,
    });
    return member?.role ?? null;
  };

// Adds an account to a workspace with a role, or brings back one who left (the
// same row, so the unique index holds). A current member keeps their row and
// role untouched: 409 is the caller's to decide (A4's invitations).
export async function addMember(
  mongo: MembersMongo,
  input: {
    workspaceId: string;
    accountId: string;
    role: WorkspaceRole;
    actorId: string;
  },
): Promise<MemberDoc> {
  const workspaceId = toObjectId(input.workspaceId);
  const members = mongo.db.members.as(input.actorId);
  const existing = await mongo.db.members.findFirst({
    workspaceId,
    accountId: input.accountId,
  });
  if (!existing) {
    return members.create({
      workspaceId,
      accountId: input.accountId,
      role: input.role,
    });
  }
  if (existing.removedAt === null) return existing;
  return members.update(existing._id, {
    role: input.role,
    removedAt: null,
    version: existing.version,
  });
}

// Takes a write lock on the workspace's current owners, inside a transaction:
// two concurrent changes that each leave one owner behind both touch the
// same rows, so MongoDB aborts and retries the second, which then sees the
// first's result. Without it, two owners demoting each other at once would
// each read "another owner remains" (snapshot isolation) and leave none.
async function lockOwners(
  tx: MembersMongo,
  workspaceId: ReturnType<typeof toObjectId>,
) {
  await tx.db.members.updateMany(
    { workspaceId, role: "OWNER", removedAt: null },
    { updatedAt: new Date() },
  );
}

async function assertAnotherOwner(
  tx: MembersMongo,
  workspaceId: ReturnType<typeof toObjectId>,
  leaving: MemberDoc,
) {
  const others = await tx.db.members.count({
    workspaceId,
    role: "OWNER",
    removedAt: null,
    _id: { $ne: leaving._id },
  });
  if (others === 0) throw lastOwner();
}

async function findActive(
  tx: MembersMongo,
  workspaceId: ReturnType<typeof toObjectId>,
  filter: { _id: string } | { accountId: string },
) {
  const key =
    "_id" in filter
      ? (() => {
          const id = tryObjectId(filter._id);
          return id ? { _id: id } : undefined;
        })()
      : filter;
  if (!key) return undefined;
  return (
    (await tx.db.members.findFirst({ ...key, workspaceId, removedAt: null })) ??
    undefined
  );
}

async function activeMember(
  tx: MembersMongo,
  workspaceId: ReturnType<typeof toObjectId>,
  filter: { _id: string } | { accountId: string },
) {
  const member = await findActive(tx, workspaceId, filter);
  if (!member) throw memberNotFound();
  return member;
}

// The receiver of a handover, read in the transaction and touched so that a
// concurrent removal or role change of it conflicts with this one.
async function lockReceiver(
  tx: MembersMongo,
  workspaceId: ReturnType<typeof toObjectId>,
  id: string,
  leaving: MemberDoc,
) {
  const receiver = await findActive(tx, workspaceId, { _id: id });
  if (!receiver || receiver._id.equals(leaving._id)) {
    throw invalidInput([
      { path: "transferTo", code: "validation.errors.invalid" },
    ]);
  }
  await tx.db.members.updateMany(
    { _id: receiver._id },
    { updatedAt: new Date() },
  );
  return receiver;
}

interface Change {
  workspaceId: string;
  actorId: string;
  // Whether the actor's role holds `owners:manage`: touching an owner, or
  // making one, is theirs alone.
  canManageOwners: boolean;
}

// Changes a member's role; answers the member and the role they had. 404 `members.errors.not-found` for a member of
// another workspace or one who left; 403 when only an owner may touch the
// member or the role; 409 `workspaces.errors.last-owner` when it would leave
// the workspace without an owner.
export async function changeRole(
  mongo: MembersMongo,
  input: Change & { memberId: string; role: WorkspaceRole },
): Promise<{ member: MemberDoc; from: WorkspaceRole }> {
  const workspaceId = toObjectId(input.workspaceId);
  return mongo.transaction(async (tx) => {
    await lockOwners(tx, workspaceId);
    const target = await activeMember(tx, workspaceId, {
      _id: input.memberId,
    });
    if (target.role === input.role)
      return { member: target, from: target.role };
    const touchesOwner = target.role === "OWNER" || input.role === "OWNER";
    if (touchesOwner && !input.canManageOwners) throw forbidden();
    if (target.role === "OWNER")
      await assertAnotherOwner(tx, workspaceId, target);
    const member = await tx.db.members
      .as(input.actorId)
      .update(target._id, { role: input.role, version: target.version });
    return { member, from: target.role };
  });
}

// Ends a membership: an admin removes a member (`memberId`), or a member
// leaves (`accountId` is theirs). The same rules as `changeRole`. Answers the
// member who left, for `memberRemoved` (members.removal.ts).
export async function endMembership(
  mongo: MembersMongo,
  input: Change &
    ({ memberId: string } | { accountId: string }) & {
      // The member who receives what the leaver made (`removeMember(transferTo:)`).
      // Read inside the transaction and write-locked like the owners, so a
      // receiver who leaves or changes concurrently aborts one of the two
      // instead of slipping in between the check and the handover. 422
      // `validation.errors.invalid` (field `transferTo`) when it is not a
      // current member or is the leaver.
      transferTo?: string;
      // Runs inside the transaction once the membership is marked ended: when it
      // throws, the membership stays (`removeMember(transferTo:)` hands the files
      // over here, so a failed handover removes nobody).
      beforeCommit?: (
        target: MemberDoc,
        receiver: MemberDoc | undefined,
      ) => Promise<unknown>;
    },
): Promise<MemberDoc> {
  const workspaceId = toObjectId(input.workspaceId);
  return mongo.transaction(async (tx) => {
    await lockOwners(tx, workspaceId);
    const target = await activeMember(
      tx,
      workspaceId,
      "memberId" in input
        ? { _id: input.memberId }
        : { accountId: input.accountId },
    );
    const receiver = input.transferTo
      ? await lockReceiver(tx, workspaceId, input.transferTo, target)
      : undefined;
    const leaving = target.accountId === input.actorId;
    if (target.role === "OWNER") {
      if (!leaving && !input.canManageOwners) throw forbidden();
      await assertAnotherOwner(tx, workspaceId, target);
    }
    await tx.db.members
      .as(input.actorId)
      .update(target._id, { removedAt: new Date(), version: target.version });
    await input.beforeCommit?.(target, receiver);
    return target;
  });
}
