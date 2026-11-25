import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { membersMongo } from "../index";
import { accountOf, memberOf, seatOf } from "./members.seat";

describe("Who", () => {
  test("a bare account id has no member, a seat has both", () => {
    expect(accountOf("acc")).toBe("acc");
    expect(memberOf("acc")).toBeNull();
    const seat = { accountId: "acc", memberId: "m1" };
    expect(accountOf(seat)).toBe("acc");
    expect(memberOf(seat)).toBe("m1");
  });
});

describe("seatOf", () => {
  test("is the current member row of the account, null for a stranger", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const joined = await w.join(workspace, "MEMBER");
    const accountId = joined.user.principal.accountId;
    const core = membersMongo(tenancy.core);
    expect(await seatOf(core, workspace.id, accountId)).toEqual({
      accountId,
      memberId: joined.memberId,
    });
    expect(await seatOf(core, workspace.id, "nobody")).toBeNull();
  });
});
