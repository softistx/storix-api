import { describe, expect, test } from "bun:test";
import { toObjectId } from "@softistx/mongo";
import { tenancy } from "@/config/tenancy";
import type { Account } from "@/core/identity";
import { workspacesMongo } from "@/core/workspaces";
import { roleArea } from "../../../../test/roles.harness";
import { notificationsMongo } from "../models";
import { Notifier } from "./notifier.service";
import { setMails } from "./preferences.service";

type Area = Awaited<ReturnType<typeof roleArea>>;

// A notifier over fake accounts (their locale chosen per account), a text that
// shows the language it was asked in, and a sender that keeps the mails.
function notifierOf(area: Area, locales: Record<string, "en" | "fr"> = {}) {
  const sent: { to: string; subject: string; id: string }[] = [];
  const logs: string[] = [];
  const failing = { on: false };
  const notifier = new Notifier({
    accounts: {
      byIds: async (ids) =>
        ids.map(
          (accountId): Account => ({
            accountId,
            email: `${accountId}@storix.test`,
            name: `Name of ${accountId}`,
            locale: locales[accountId] ?? "en",
            emailVerified: true,
          }),
        ),
    },
    send: async (mail, id) => {
      if (failing.on) throw new Error("queue down");
      sent.push({ to: mail.to, subject: mail.subject, id });
    },
    text: (language, key) => `${language}:${key}`,
    log: (message) => logs.push(message),
  });
  const scope = {
    tenant: { id: area.workspace.id, name: "Acme" },
    mongo: area.database,
    core: tenancy.core,
  } as never;
  return { notifier, sent, logs, failing, scope };
}

const mongo = () => notificationsMongo(tenancy.core);
const inboxOf = (accountId: string) =>
  mongo().db.notifications.findMany({ filter: { accountId } });

async function shareEvent(area: Area, guestMemberId: string, actorId?: string) {
  return {
    actorId: actorId ?? area.workspace.owner.principal.accountId,
    node: { id: area.folder.id, name: "Shared" },
    principal: { type: "MEMBER" as const, id: guestMemberId },
    role: "EDITOR" as const,
  };
}

describe("the notifier", () => {
  test("a share notifies the recipient and mails them in their language", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const guestId = guest.user.principal.accountId;
    const n = notifierOf(a, { [guestId]: "fr" });
    await n.notifier.shared({
      scope: n.scope,
      ...(await shareEvent(a, guest.memberId)),
    });
    const inbox = await inboxOf(guestId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "SHARED",
      nodeName: "Shared",
      role: "EDITOR",
      readAt: null,
    });
    expect(n.sent).toEqual([
      {
        to: `${guestId}@storix.test`,
        subject: "fr:notifications.mail.shared.subject",
        id: `notification-${inbox[0]?.id}`,
      },
    ]);
  });

  test("a role change is its own kind and mail", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const n = notifierOf(a);
    await n.notifier.roleChanged({
      scope: n.scope,
      ...(await shareEvent(a, guest.memberId)),
    });
    const inbox = await inboxOf(guest.user.principal.accountId);
    expect(inbox.map((x) => x.kind)).toEqual(["ROLE_CHANGED"]);
    expect(n.sent[0]?.subject).toBe(
      "en:notifications.mail.role-changed.subject",
    );
  });

  test("nobody is told of what they did themself", async () => {
    const a = await roleArea();
    const me = await a.w.join(a.workspace, "MEMBER");
    const n = notifierOf(a);
    await n.notifier.shared({
      scope: n.scope,
      ...(await shareEvent(a, me.memberId, me.user.principal.accountId)),
    });
    expect(await inboxOf(me.user.principal.accountId)).toEqual([]);
    expect(n.sent).toEqual([]);
  });

  test("a team grant gives one notification and one mail per member", async () => {
    const a = await roleArea();
    const one = await a.w.join(a.workspace, "MEMBER");
    const two = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team("Crew", [one.memberId, two.memberId]);
    const n = notifierOf(a);
    await n.notifier.shared({
      scope: n.scope,
      actorId: a.workspace.owner.principal.accountId,
      node: { id: a.folder.id, name: "Shared" },
      principal: { type: "TEAM", id: teamId },
      role: "VIEWER",
    });
    expect(n.sent.map((m) => m.to).sort()).toEqual(
      [one, two].map((u) => `${u.user.principal.accountId}@storix.test`).sort(),
    );
    for (const u of [one, two]) {
      expect(await inboxOf(u.user.principal.accountId)).toHaveLength(1);
    }
  });

  test("mails off keeps the notification and sends nothing", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    await setMails(mongo(), guest.user.principal.accountId, false);
    const n = notifierOf(a);
    await n.notifier.shared({
      scope: n.scope,
      ...(await shareEvent(a, guest.memberId)),
    });
    expect(await inboxOf(guest.user.principal.accountId)).toHaveLength(1);
    expect(n.sent).toEqual([]);
  });

  test("a sender that fails is logged and the notification stands", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const n = notifierOf(a);
    n.failing.on = true;
    await n.notifier.shared({
      scope: n.scope,
      ...(await shareEvent(a, guest.memberId)),
    });
    expect(await inboxOf(guest.user.principal.accountId)).toHaveLength(1);
    expect(n.logs.join()).toContain("not sent");
  });

  test("an event that cannot be notified never throws", async () => {
    const a = await roleArea();
    const n = notifierOf(a);
    await n.notifier.shared({
      scope: { tenant: { id: "bad" }, mongo: null, core: null } as never,
      actorId: "x",
      node: { id: "y", name: "z" },
      principal: { type: "MEMBER", id: "w" },
      role: "VIEWER",
    });
    expect(n.logs).toHaveLength(1);
  });
});

async function setUsage(area: Area, bytes: number, quota: number) {
  await workspacesMongo(tenancy.core).db.workspaces.raw.updateOne(
    { _id: toObjectId(area.workspace.id) },
    { $set: { quotaBytes: quota, "usage.bytes": bytes } },
  );
}

describe("the quota alerts", () => {
  test("80 % tells the owners and the admins once, the uploading one included, and 100 % tells again", async () => {
    const a = await roleArea();
    const admin = await a.w.join(a.workspace, "ADMIN");
    const member = await a.w.join(a.workspace, "MEMBER");
    const n = notifierOf(a);
    await setUsage(a, 50, 100);
    await n.notifier.usage({ scope: n.scope });
    expect(n.sent).toEqual([]);

    await setUsage(a, 80, 100);
    await n.notifier.usage({ scope: n.scope });
    await n.notifier.usage({ scope: n.scope });
    expect(n.sent).toHaveLength(2);
    expect(await inboxOf(member.user.principal.accountId)).toEqual([]);
    const adminInbox = await inboxOf(admin.user.principal.accountId);
    expect(adminInbox.map((x) => [x.kind, x.percent])).toEqual([
      ["QUOTA_THRESHOLD", 80],
    ]);

    await setUsage(a, 100, 100);
    await n.notifier.usage({ scope: n.scope });
    expect(n.sent).toHaveLength(4);
    expect(
      (await inboxOf(admin.user.principal.accountId))
        .map((x) => x.percent)
        .sort((x, y) => (x ?? 0) - (y ?? 0)),
    ).toEqual([80, 100]);
  });

  test("usage that fell and rose again is a new crossing", async () => {
    const a = await roleArea();
    const n = notifierOf(a);
    await setUsage(a, 85, 100);
    await n.notifier.usage({ scope: n.scope });
    await setUsage(a, 10, 100);
    await n.notifier.usage({ scope: n.scope });
    await setUsage(a, 90, 100);
    await n.notifier.usage({ scope: n.scope });
    expect(n.sent).toHaveLength(2);
  });
});
