import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../../test/roles.harness";
import { nodesMongo } from "../models";
import { pathTo } from "./tree.service";

describe("pathTo", () => {
  test("an owner sees the whole way down from their root", async () => {
    const a = await roleArea();
    const path = await pathTo(
      nodesMongo(a.database),
      a.child.id,
      a.workspace.owner.principal.accountId,
    );
    expect(path.map((n) => n.id)).toEqual([a.root.id, a.folder.id, a.child.id]);
  });

  test("a grantee on a subfolder sees no name above the share point", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: guest.memberId },
      "VIEWER",
    );
    const seat = {
      accountId: guest.user.principal.accountId,
      memberId: guest.memberId,
    };
    const path = await pathTo(nodesMongo(a.database), a.child.id, seat);
    expect(path.map((n) => n.name)).toEqual(["Shared", "Child"]);
  });
});
