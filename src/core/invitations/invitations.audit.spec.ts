import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AuditEventInput } from "@/core/audit";
import type { Context } from "@/http/context";
import {
  recordInvitationAccept,
  recordInvitationWrite,
} from "./services/invitations.audit";

const viewer = { accountId: "a1", name: "Ada" };
const record = mock(async (_event: AuditEventInput) => {});
const ctx = (v: unknown) =>
  ({
    audit: { record },
    viewer: v,
    ip: "127.0.0.1",
    identity: { accounts: { byEmail: async () => undefined } },
  }) as unknown as Context;

afterEach(() => record.mockClear());

describe("the invitation write events", () => {
  for (const answer of [null, undefined, "x", {}, { invitation: null }]) {
    for (const action of ["issue", "resend", "revoke"] as const) {
      test(`${action} with the answer ${JSON.stringify(answer)} records nothing and does not throw`, async () => {
        await expect(
          recordInvitationWrite(action, ctx(viewer), answer),
        ).resolves.toBeUndefined();
        expect(record).not.toHaveBeenCalled();
      });
    }
  }

  test("no viewer records nothing, whatever the answer", async () => {
    await recordInvitationWrite("issue", ctx(null), {
      invitation: { id: "i1", scope: "w1", email: "e@x.test", role: "ADMIN" },
    });
    expect(record).not.toHaveBeenCalled();
  });

  test("a readable answer records the event in the invitation's workspace", async () => {
    await recordInvitationWrite("issue", ctx(viewer), {
      invitation: { id: "i1", scope: "w1", email: "e@x.test", role: "ADMIN" },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "w1",
      action: "invitation.issue",
    });
  });
});

describe("the invitation accept event", () => {
  const invitation = {
    id: "i1",
    scope: "w1",
    email: "e@x.test",
    role: "ADMIN",
  };
  for (const answer of [null, undefined, "x"]) {
    test(`the answer ${JSON.stringify(answer)} never throws`, async () => {
      await expect(
        recordInvitationAccept(ctx(viewer), invitation, answer),
      ).resolves.toBeUndefined();
      expect(record).not.toHaveBeenCalled();
    });
  }
});
