import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../../test/roles.harness";
import {
  dropGrants,
  dropMemberGrants,
  grantNode,
  grantOf,
  grantsOnNode,
  regrant,
  revoke,
} from "./grants.service";

describe("the grants of a node", () => {
  test("grantNode records one grant per principal, and a second is refused", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    const input = {
      nodeId: a.folder.id,
      principal: { type: "MEMBER" as const, id: memberId },
      role: "VIEWER" as const,
      accountId: "owner",
    };
    const made = await grantNode(a.database, input);
    expect(made.role).toBe("VIEWER");
    expect(made.grantedBy).toBe("owner");
    await expect(grantNode(a.database, input)).rejects.toMatchObject({
      extensions: { code: "shares.errors.already-shared" },
    });
  });

  test("regrant changes the role, revoke ends the grant, and an unknown id is a 404", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    const made = await a.grant(
      a.folder.id,
      { type: "MEMBER", id: memberId },
      "VIEWER",
    );
    const changed = await regrant(a.database, {
      nodeId: a.folder.id,
      id: made.id,
      role: "EDITOR",
      accountId: "owner",
    });
    expect(changed.before.role).toBe("VIEWER");
    expect(changed.grant.role).toBe("EDITOR");
    // The grant is on the folder, not on its child.
    await expect(
      grantOf(a.database, a.child.id, made.id),
    ).rejects.toBeDefined();
    await revoke(a.database, { nodeId: a.folder.id, id: made.id });
    expect(await grantsOnNode(a.database, a.folder.id)).toEqual([]);
    await expect(
      grantOf(a.database, a.folder.id, "nope"),
    ).rejects.toBeDefined();
  });

  test("dropGrants forgets the grants of the nodes it is given", async () => {
    const a = await roleArea();
    const { memberId } = await a.w.join(a.workspace, "MEMBER");
    const principal = { type: "MEMBER" as const, id: memberId };
    await a.grant(a.folder.id, principal, "VIEWER");
    await a.grant(a.sibling.id, principal, "VIEWER");
    await dropGrants(a.database, []);
    expect(await grantsOnNode(a.database, a.folder.id)).toHaveLength(1);
    await dropGrants(a.database, [a.folder.id]);
    expect(await grantsOnNode(a.database, a.folder.id)).toEqual([]);
    expect(await grantsOnNode(a.database, a.sibling.id)).toHaveLength(1);
  });

  test("dropMemberGrants ends the grants a member holds and keeps the others", async () => {
    const a = await roleArea();
    const gone = await a.w.join(a.workspace, "MEMBER");
    const kept = await a.w.join(a.workspace, "MEMBER");
    await a.grant(a.folder.id, { type: "MEMBER", id: gone.memberId }, "VIEWER");
    await a.grant(a.child.id, { type: "MEMBER", id: gone.memberId }, "EDITOR");
    await a.grant(a.folder.id, { type: "MEMBER", id: kept.memberId }, "VIEWER");
    await dropMemberGrants(a.database, gone.memberId);
    const left = [
      ...(await grantsOnNode(a.database, a.folder.id)),
      ...(await grantsOnNode(a.database, a.child.id)),
    ];
    expect(left.map((g) => g.principal.id.toHexString())).toEqual([
      kept.memberId,
    ]);
  });
});
