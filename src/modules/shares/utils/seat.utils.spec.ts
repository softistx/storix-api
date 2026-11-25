import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { callerSeat } from "./seat.utils";

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

  test("an account that is not a member is refused", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const scope = { core: tenancy.core, tenant: { id: workspace.id } };
    await expect(callerSeat(scope, "nobody")).rejects.toThrow();
  });
});
