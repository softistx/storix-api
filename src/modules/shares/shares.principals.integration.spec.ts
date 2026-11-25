import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../test/roles.harness";
import { SHARE } from "../../../test/shares.harness";
import { sharesMongo } from "./models";

const DELETE_TEAM = "mutation($id: ID!) { deleteTeam(id: $id) }";

describe("who a node can be shared with", () => {
  test("not its own owner, who holds OWNER already", async () => {
    const a = await roleArea();
    const ownerMemberId = await a.w.memberIdOf(a.workspace, a.workspace.owner);
    const refused = await a.w.send(a.workspace.owner, SHARE, {
      workspace: a.workspace.id,
      variables: {
        id: a.folder.id,
        principal: { type: "MEMBER", id: ownerMemberId },
        role: "VIEWER",
      },
    });
    expect(a.w.codeOf(refused)).toBe("shares.errors.principal-unknown");
    const grants = await sharesMongo(a.database).db.grants.findMany({
      filter: {},
    });
    expect(grants).toEqual([]);
  });
});

describe("a team that is deleted", () => {
  test("takes the grants made to it away", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team("Crew", [guest.memberId]);
    await a.grant(a.folder.id, { type: "TEAM", id: teamId }, "VIEWER");
    await a.grant(
      a.sibling.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );

    const deleted = await a.w.send(a.workspace.owner, DELETE_TEAM, {
      workspace: a.workspace.id,
      variables: { id: teamId },
    });
    expect(deleted.errors).toBeUndefined();
    const left = await sharesMongo(a.database).db.grants.findMany({
      filter: {},
    });
    expect(left.map((g) => g.principal.type)).toEqual(["MEMBER"]);
  });
});
