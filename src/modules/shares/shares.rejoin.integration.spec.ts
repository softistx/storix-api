import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { members } from "@/config/wiring";
import { addMember, memberJoined, membersMongo } from "@/core/members";
import { roleArea } from "../../../test/roles.harness";

const REMOVE = `mutation($memberId: ID!) { removeMember(memberId: $memberId) }`;

describe("a member who leaves and rejoins", () => {
  test("gets none of the shares they held before", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );
    const asGuest = a.as(guest.user);
    expect(await asGuest.names(a.folder.id)).toEqual(["Child"]);

    const removed = await a.owner.send(REMOVE, { memberId: guest.memberId });
    expect(removed.errors).toBeUndefined();
    await addMember(membersMongo(tenancy.core), {
      workspaceId: a.workspace.id,
      accountId: guest.user.principal.accountId,
      role: "MEMBER",
      actorId: a.workspace.owner.principal.accountId,
    });

    expect(await asGuest.names(a.folder.id)).toEqual([]);
    const read = await asGuest.send(
      "query($id: ID!) { node(id: $id) { id } }",
      { id: a.folder.id },
    );
    expect(a.w.codeOf(read)).toBe("nodes.errors.not-found");
  });

  test("gets none of a share that raced the removal and named their row", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const removed = await a.owner.send(REMOVE, { memberId: guest.memberId });
    expect(removed.errors).toBeUndefined();
    // A grant written while the member was leaving, after the clean-up ran.
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "EDITOR",
    );
    const row = await addMember(membersMongo(tenancy.core), {
      workspaceId: a.workspace.id,
      accountId: guest.user.principal.accountId,
      role: "MEMBER",
      actorId: a.workspace.owner.principal.accountId,
    });
    await memberJoined(members, row);

    const read = await a
      .as(guest.user)
      .send("query($id: ID!) { node(id: $id) { id } }", { id: a.folder.id });
    expect(a.w.codeOf(read)).toBe("nodes.errors.not-found");
  });
});
