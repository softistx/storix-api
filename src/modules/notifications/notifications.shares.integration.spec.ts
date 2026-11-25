import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { roleArea } from "../../../test/roles.harness";
import { CHANGE, SHARE } from "../../../test/shares.harness";
import { notificationsMongo } from "./models";

const INBOX = `{ notifications(first: 50) { totalCount nodes { id kind nodeName role actorId readAt } } }`;
const MAILS = `mutation($mails: Boolean!) { setMailPreferences(mails: $mails) { mails } }`;

type Area = Awaited<ReturnType<typeof roleArea>>;
type Person = Awaited<ReturnType<Area["w"]["join"]>>;

// What a person sees in their inbox, and the notification mails they got.
async function seen(a: Area, who: { user: Person["user"] }) {
  const inbox = await a.w.send(who.user, INBOX);
  const mails = a.w.h
    .mailsTo(who.user.email)
    .filter((mail) => mail.subject.startsWith("notifications.mail."));
  return {
    nodes: inbox.data?.["notifications"].nodes as {
      kind: string;
      nodeName: string;
      role: string;
      actorId: string;
    }[],
    mails,
  };
}

const share = (
  a: Area,
  as: Person["user"],
  principal: { type: "MEMBER" | "TEAM"; id: string },
  role: "VIEWER" | "EDITOR" = "VIEWER",
) =>
  a.w.send(as, SHARE, {
    workspace: a.workspace.id,
    variables: { id: a.folder.id, principal, role },
  });

describe("an account that leaves a workspace", () => {
  test("loses that workspace's lines of its inbox", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    await share(a, a.workspace.owner, { type: "MEMBER", id: guest.memberId });
    expect((await seen(a, guest)).nodes).toHaveLength(1);

    const removed = await a.owner.send(
      `mutation($memberId: ID!) { removeMember(memberId: $memberId) }`,
      { memberId: guest.memberId },
    );
    expect(removed.errors).toBeUndefined();
    const left = await notificationsMongo(
      tenancy.core,
    ).db.notifications.findMany({
      filter: { accountId: guest.user.principal.accountId },
    });
    expect(left).toEqual([]);
  });
});

describe("sharing notifies the people it reaches", () => {
  test("a share to a member gives them one notification and one mail, and the owner none", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const made = await share(a, a.workspace.owner, {
      type: "MEMBER",
      id: guest.memberId,
    });
    expect(made.errors).toBeUndefined();

    const theirs = await seen(a, guest);
    expect(theirs.nodes).toHaveLength(1);
    expect(theirs.nodes[0]).toMatchObject({
      kind: "SHARED",
      nodeName: "Shared",
      role: "VIEWER",
      actorId: a.workspace.owner.principal.accountId,
    });
    expect(theirs.mails).toHaveLength(1);
    expect(theirs.mails[0]?.subject).toBe("notifications.mail.shared.subject");

    const mine = await seen(a, { user: a.workspace.owner });
    expect(mine.nodes).toEqual([]);
    expect(mine.mails).toEqual([]);
  });

  test("a share to a team gives exactly one notification and one mail per member", async () => {
    const a = await roleArea();
    const crew = [
      await a.w.join(a.workspace, "MEMBER"),
      await a.w.join(a.workspace, "MEMBER"),
      await a.w.join(a.workspace, "MEMBER"),
    ];
    const outsider = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team(
      "Crew",
      crew.map((c) => c.memberId),
    );
    const made = await share(a, a.workspace.owner, {
      type: "TEAM",
      id: teamId,
    });
    expect(made.errors).toBeUndefined();

    for (const member of crew) {
      const got = await seen(a, member);
      expect(got.nodes).toHaveLength(1);
      expect(got.mails).toHaveLength(1);
    }
    const none = await seen(a, outsider);
    expect(none.nodes).toEqual([]);
    expect(none.mails).toEqual([]);
    expect((await seen(a, { user: a.workspace.owner })).mails).toEqual([]);
  });

  test("a team member who shares with their own team tells the others, never themself", async () => {
    const a = await roleArea();
    const sharer = await a.w.join(a.workspace, "MEMBER");
    const mate = await a.w.join(a.workspace, "MEMBER");
    const teamId = await a.team("Pair", [sharer.memberId, mate.memberId]);
    // The owner makes the first member an editor, who may then share.
    const first = await share(
      a,
      a.workspace.owner,
      { type: "MEMBER", id: sharer.memberId },
      "EDITOR",
    );
    expect(first.errors).toBeUndefined();
    const before = await seen(a, sharer);

    const made = await share(a, sharer.user, { type: "TEAM", id: teamId });
    expect(made.errors).toBeUndefined();

    const mine = await seen(a, sharer);
    expect(mine.nodes).toHaveLength(before.nodes.length);
    expect(mine.mails).toHaveLength(before.mails.length);
    const theirs = await seen(a, mate);
    expect(theirs.nodes).toHaveLength(1);
    expect(theirs.mails).toHaveLength(1);
  });

  test("sharing with oneself notifies nobody", async () => {
    const a = await roleArea();
    const ownerSeat = await a.w.memberIdOf(a.workspace, a.workspace.owner);
    await share(a, a.workspace.owner, { type: "MEMBER", id: ownerSeat });
    const mine = await seen(a, { user: a.workspace.owner });
    expect(mine.nodes).toEqual([]);
    expect(mine.mails).toEqual([]);
  });

  test("changing a role tells the recipient once, and only when the role changed", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const made = await share(a, a.workspace.owner, {
      type: "MEMBER",
      id: guest.memberId,
    });
    const grantId = made.data?.["shareNode"].id as string;
    const change = (role: "VIEWER" | "EDITOR") =>
      a.w.send(a.workspace.owner, CHANGE, {
        workspace: a.workspace.id,
        variables: { id: a.folder.id, grantId, role },
      });

    expect((await change("EDITOR")).errors).toBeUndefined();
    const got = await seen(a, guest);
    expect(got.nodes.map((n) => [n.kind, n.role]).sort()).toEqual([
      ["ROLE_CHANGED", "EDITOR"],
      ["SHARED", "VIEWER"],
    ]);
    expect(got.mails.map((m) => m.subject).sort()).toEqual([
      "notifications.mail.role-changed.subject",
      "notifications.mail.shared.subject",
    ]);

    expect((await change("EDITOR")).errors).toBeUndefined();
    expect((await seen(a, guest)).nodes).toHaveLength(2);
  });

  test("with mails off the notification is recorded and no mail is sent", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const off = await a.w.send(guest.user, MAILS, {
      variables: { mails: false },
    });
    expect(off.data?.["setMailPreferences"]).toEqual({ mails: false });
    await share(a, a.workspace.owner, { type: "MEMBER", id: guest.memberId });
    const got = await seen(a, guest);
    expect(got.nodes).toHaveLength(1);
    expect(got.mails).toEqual([]);
  });

  test("a share that is refused notifies nobody", async () => {
    const a = await roleArea();
    const guest = await a.w.join(a.workspace, "MEMBER");
    const once = { type: "MEMBER" as const, id: guest.memberId };
    await share(a, a.workspace.owner, once);
    const again = await share(a, a.workspace.owner, once);
    expect(a.w.codeOf(again)).toBe("shares.errors.already-shared");
    expect((await seen(a, guest)).nodes).toHaveLength(1);
  });
});
