import { describe, expect, test } from "bun:test";
import type { Context } from "@/http/context";
import { recordInvitationWrite } from "./invitations.audit";

describe("the invitation write events", () => {
  const viewer = { accountId: "a1", name: "Ada" };
  const ctx = (v: unknown) => ({ viewer: v, ip: "127.0.0.1" }) as Context;

  for (const answer of [null, undefined, "x", {}, { invitation: null }]) {
    for (const action of ["issue", "resend", "revoke"] as const) {
      test(`${action} with the answer ${JSON.stringify(answer)} records nothing and does not throw`, async () => {
        await expect(
          recordInvitationWrite(action, ctx(viewer), answer),
        ).resolves.toBeUndefined();
      });
    }
  }

  test("no viewer records nothing, whatever the answer", async () => {
    await expect(
      recordInvitationWrite("issue", ctx(null), null),
    ).resolves.toBeUndefined();
  });
});
