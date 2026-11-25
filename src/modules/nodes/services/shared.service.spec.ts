import { describe, expect, test } from "bun:test";
import { sharesMongo } from "@/modules/shares/public";
import { roleArea } from "../../../../test/roles.harness";
import { sharedByMe, sharedWithMe } from "./shared.service";

const seat = (
  user: { principal: { accountId: string } },
  memberId: string,
) => ({
  accountId: user.principal.accountId,
  memberId,
});

describe("sharedWithMe and sharedByMe", () => {
  test("a grant on a folder lists it, and not the child under it", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const principal = { type: "MEMBER" as const, id: guest.memberId };
    await a.grant(a.folder.id, principal, "VIEWER");
    await a.grant(a.child.id, principal, "EDITOR");
    const who = seat(guest.user, guest.memberId);
    const page = await sharedWithMe(a.database, { who, first: 10 });
    expect(page.items.map((n) => n._id.toHexString())).toEqual([a.folder.id]);
    expect(page.endCursor).toBeNull();
  });

  test("sharedByMe lists the nodes the caller granted, not the owner's", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const owner = a.workspace.owner.principal.accountId;
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );
    // the seed grants carry grantedBy "seed": none is the owner's own
    const none = await sharedByMe(a.database, { who: owner, first: 10 });
    expect(none.items).toEqual([]);
    await sharesMongo(a.database)
      .db.grants.as(owner)
      .create({
        nodeId: a.folder.id as never,
        principal: { type: "MEMBER", id: a.workspace.id as never },
        role: "VIEWER",
        grantedBy: owner,
      });
    const mine = await sharedByMe(a.database, { who: owner, first: 10 });
    expect(mine.items.map((n) => n._id.toHexString())).toEqual([a.folder.id]);
    const other = seat(guest.user, guest.memberId);
    expect(
      (await sharedByMe(a.database, { who: other, first: 10 })).items,
    ).toEqual([]);
  });

  test("an editor whose own grant is revoked no longer lists their re-share", async () => {
    const a = await roleArea();
    const editor = await a.w.join(a.workspace, "MEMBER");
    const mine = await a.grant(
      a.folder.id,
      { type: "MEMBER", id: editor.memberId },
      "EDITOR",
    );
    await sharesMongo(a.database)
      .db.grants.as(editor.user.principal.accountId)
      .create({
        nodeId: a.folder.id as never,
        principal: { type: "MEMBER", id: a.workspace.id as never },
        role: "VIEWER",
        grantedBy: editor.user.principal.accountId,
      });
    const who = seat(editor.user, editor.memberId);
    const before = await sharedByMe(a.database, { who, first: 10 });
    expect(before.items.map((n) => n._id.toHexString())).toEqual([a.folder.id]);
    await sharesMongo(a.database).db.grants.deleteMany({ _id: mine._id });
    const after = await sharedByMe(a.database, { who, first: 10 });
    expect(after.items).toEqual([]);
  });

  test("the owner still lists their node that an editor re-shared", async () => {
    const a = await roleArea();
    const owner = a.workspace.owner.principal.accountId;
    const ownerSeat = seat(
      a.workspace.owner,
      await a.w.memberIdOf(a.workspace, a.workspace.owner),
    );
    await sharesMongo(a.database)
      .db.grants.as(owner)
      .create({
        nodeId: a.folder.id as never,
        principal: { type: "MEMBER", id: a.workspace.id as never },
        role: "VIEWER",
        grantedBy: owner,
      });
    const page = await sharedByMe(a.database, { who: ownerSeat, first: 10 });
    expect(page.items.map((n) => n._id.toHexString())).toEqual([a.folder.id]);
  });

  test("an empty grant set still refuses a cursor of another listing", async () => {
    const a = await roleArea();
    const who = a.workspace.owner.principal.accountId;
    await expect(
      sharedByMe(a.database, { who, first: 5, after: "not-a-cursor" }),
    ).rejects.toThrow();
  });

  test("an empty grant set answers an empty page", async () => {
    const a = await roleArea();
    const who = a.workspace.owner.principal.accountId;
    expect(await sharedByMe(a.database, { who, first: 5 })).toEqual({
      items: [],
      endCursor: null,
    });
  });
});
