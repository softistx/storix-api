import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { membersMongo } from "@/core/members";
import { roleArea } from "../../../../test/roles.harness";
import { administratorsOf, recipientsOfGrant } from "./recipients.service";

const members = () => membersMongo(tenancy.core);

describe("who a grant reaches", () => {
  test("a member grant reaches that member", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const reached = await recipientsOfGrant(
      { members: members(), database: a.database, workspaceId: a.workspace.id },
      {
        principal: { type: "MEMBER", id: guest.memberId },
        actorId: a.workspace.owner.principal.accountId,
      },
    );
    expect(reached).toEqual([guest.user.principal.accountId]);
  });

  test("a team grant reaches each member once, the actor left out", async () => {
    const a = await roleArea();
    const one = await a.w.join(a.workspace, "MEMBER");
    const two = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team("Crew", [one.memberId, two.memberId]);
    const deps = {
      members: members(),
      database: a.database,
      workspaceId: a.workspace.id,
    };
    const all = await recipientsOfGrant(deps, {
      principal: { type: "TEAM", id: teamId },
      actorId: a.workspace.owner.principal.accountId,
    });
    expect(all.sort()).toEqual(
      [one.user.principal.accountId, two.user.principal.accountId].sort(),
    );
    const withoutOne = await recipientsOfGrant(deps, {
      principal: { type: "TEAM", id: teamId },
      actorId: one.user.principal.accountId,
    });
    expect(withoutOne).toEqual([two.user.principal.accountId]);
  });

  test("a member who sent the grant to themself reaches nobody", async () => {
    const a = await roleArea();
    const me = await a.w.join(a.workspace, "MEMBER");
    const reached = await recipientsOfGrant(
      { members: members(), database: a.database, workspaceId: a.workspace.id },
      {
        principal: { type: "MEMBER", id: me.memberId },
        actorId: me.user.principal.accountId,
      },
    );
    expect(reached).toEqual([]);
  });

  test("a team that no longer exists, or an empty one, reaches nobody", async () => {
    const a = await roleArea();
    const deps = {
      members: members(),
      database: a.database,
      workspaceId: a.workspace.id,
    };
    const empty = await a.team("Empty", []);
    for (const id of [empty, "6563f8f0a1b2c3d4e5f60700"]) {
      expect(
        await recipientsOfGrant(deps, {
          principal: { type: "TEAM", id },
          actorId: "x",
        }),
      ).toEqual([]);
    }
  });

  test("administrators are the owner and the admins, not the members", async () => {
    const a = await roleArea();
    const admin = await a.w.join(a.workspace, "ADMIN");
    await a.w.join(a.workspace, "MEMBER");
    const admins = await administratorsOf(members(), a.workspace.id);
    expect(admins.sort()).toEqual(
      [
        a.workspace.owner.principal.accountId,
        admin.user.principal.accountId,
      ].sort(),
    );
  });
});
