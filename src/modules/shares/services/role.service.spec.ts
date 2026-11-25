import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../../test/roles.harness";
import { roleOn, rolesOn } from "./role.service";

describe("roleOn", () => {
  test("the account that owns the tree is its OWNER, with no grant", async () => {
    const a = await roleArea();
    const node = await a.nodeOf(a.child.id);
    expect(await roleOn(a.database, node.ownerId as string, node)).toBe(
      "OWNER",
    );
  });

  test("a grant on a folder reaches its subtree, not its siblings or parent", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    await a.grant(a.folder.id, { type: "MEMBER", id: memberId }, "EDITOR");
    const seat = { accountId: "someone", memberId };
    const role = async (id: string) =>
      roleOn(a.database, seat, await a.nodeOf(id));
    expect(await role(a.folder.id)).toBe("EDITOR");
    expect(await role(a.child.id)).toBe("EDITOR");
    expect(await role(a.sibling.id)).toBeNull();
    expect(await role(a.root.id)).toBeNull();
  });

  test("a team grant reaches each of its members, and the highest grant wins", async () => {
    const a = await roleArea();
    const inTeam = await a.w.join(a.workspace, "MEMBER");
    const outside = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team("Readers", [inTeam.memberId]);
    await a.grant(a.folder.id, { type: "TEAM", id: teamId }, "VIEWER");
    const node = await a.nodeOf(a.child.id);
    const asTeam = { accountId: "t", memberId: inTeam.memberId };
    const asOutside = { accountId: "o", memberId: outside.memberId };
    expect(await roleOn(a.database, asTeam, node)).toBe("VIEWER");
    expect(await roleOn(a.database, asOutside, node)).toBeNull();
    await a.grant(
      a.child.id,
      { type: "MEMBER", id: inTeam.memberId },
      "EDITOR",
    );
    expect(await roleOn(a.database, asTeam, node)).toBe("EDITOR");
  });

  test("a bare account id holds no grant", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    await a.grant(a.folder.id, { type: "MEMBER", id: memberId }, "VIEWER");
    const node = await a.nodeOf(a.folder.id);
    expect(await roleOn(a.database, "someone", node)).toBeNull();
  });
});

describe("rolesOn", () => {
  test("answers one role per node, in order, from one read of the grants", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    await a.grant(a.folder.id, { type: "MEMBER", id: memberId }, "EDITOR");
    const seat = { accountId: "someone", memberId };
    const nodes = await Promise.all(
      [a.child.id, a.sibling.id, a.folder.id].map(a.nodeOf),
    );
    expect(await rolesOn(a.database, seat, nodes)).toEqual([
      "EDITOR",
      null,
      "EDITOR",
    ]);
  });

  test("a trashed node is its owner's alone: a grant gives nobody a role on it", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    await a.grant(a.folder.id, { type: "MEMBER", id: memberId }, "EDITOR");
    const node = await a.nodeOf(a.folder.id);
    const seat = { accountId: "someone", memberId };
    const trashed = { ...node, trashed: true };
    expect(await rolesOn(a.database, seat, [trashed])).toEqual([null]);
    expect(
      await rolesOn(a.database, node.ownerId as string, [trashed]),
    ).toEqual(["OWNER"]);
  });
});
