import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { addMember, membersMongo } from "@/core/members";
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
});
