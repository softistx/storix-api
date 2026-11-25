import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { membersMongo } from "../index";
import { accountOf, callerSeat, memberOf, seatOf } from "./members.seat";

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

describe("callerSeat", () => {
  test("is the member row of the account in the request's workspace", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const joined = await w.join(workspace, "MEMBER");
    const scope = { core: tenancy.core, tenant: { id: workspace.id } };
    const seat = await callerSeat(scope, joined.user.principal.accountId);
    expect(seat).toEqual({
      accountId: joined.user.principal.accountId,
      memberId: joined.memberId,
    });
  });

  test("an account that is not a member is refused as an unknown workspace", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const scope = { core: tenancy.core, tenant: { id: workspace.id } };
    const refused = await callerSeat(scope, "nobody").catch((e: unknown) => e);
    expect(refused).toMatchObject({
      extensions: { code: "workspaces.errors.not-found" },
    });
  });
});
