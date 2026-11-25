import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { notificationsMongo } from "../models";
import {
  listNotifications,
  markAllRead,
  markRead,
  recordNotifications,
  unreadCount,
} from "./inbox.service";

const mongo = () => notificationsMongo(tenancy.core);
const fresh = () => `acct-${crypto.randomUUID()}`;
const workspaceId = "6563f8f0a1b2c3d4e5f60718";
const row = (accountId: string, name: string) => ({
  accountId,
  workspaceId,
  kind: "SHARED" as const,
  actorId: "someone",
  nodeId: "6563f8f0a1b2c3d4e5f60719",
  nodeName: name,
  role: "VIEWER" as const,
});

describe("the inbox of an account", () => {
  test("lists the caller's notifications newest first, a page at a time", async () => {
    await world();
    const me = fresh();
    for (const name of ["a", "b", "c"]) {
      await recordNotifications(mongo(), [row(me, name)]);
    }
    await recordNotifications(mongo(), [row(fresh(), "other")]);
    const first = await listNotifications(mongo(), {
      accountId: me,
      first: 2,
      after: null,
      unreadOnly: false,
    });
    expect(first.items.map((n) => n.nodeName)).toEqual(["c", "b"]);
    expect(first.totalCount).toBe(3);
    expect(first.endCursor).not.toBeNull();
    const second = await listNotifications(mongo(), {
      accountId: me,
      first: 2,
      after: first.endCursor,
      unreadOnly: false,
    });
    expect(second.items.map((n) => n.nodeName)).toEqual(["a"]);
  });

  test("unreadOnly and the unread count leave out what was read", async () => {
    await world();
    const me = fresh();
    const [one] = await recordNotifications(mongo(), [
      row(me, "a"),
      row(me, "b"),
    ]);
    expect(await unreadCount(mongo(), me)).toBe(2);
    await markRead(mongo(), { accountId: me, id: one?.id as string });
    expect(await unreadCount(mongo(), me)).toBe(1);
    const unread = await listNotifications(mongo(), {
      accountId: me,
      first: 10,
      after: null,
      unreadOnly: true,
    });
    expect(unread.items.map((n) => n.nodeName)).toEqual(["b"]);
    expect(unread.totalCount).toBe(1);
  });

  test("marking one read twice keeps its first read time", async () => {
    await world();
    const me = fresh();
    const [one] = await recordNotifications(mongo(), [row(me, "a")]);
    const first = await markRead(mongo(), {
      accountId: me,
      id: one?.id as string,
    });
    const again = await markRead(mongo(), {
      accountId: me,
      id: one?.id as string,
    });
    expect(first.readAt).not.toBeNull();
    expect(again.readAt?.getTime()).toBe(first.readAt?.getTime() as number);
  });

  test("an unknown, malformed or foreign id is one 404", async () => {
    await world();
    const me = fresh();
    const [theirs] = await recordNotifications(mongo(), [row(fresh(), "x")]);
    for (const id of [
      "nope",
      "6563f8f0a1b2c3d4e5f60700",
      theirs?.id as string,
    ]) {
      await expect(
        markRead(mongo(), { accountId: me, id }),
      ).rejects.toMatchObject({
        extensions: { code: "notifications.errors.not-found" },
      });
    }
    expect(await unreadCount(mongo(), theirs?.accountId as string)).toBe(1);
  });

  test("marking all read counts what it changed and touches nobody else", async () => {
    await world();
    const me = fresh();
    const other = fresh();
    await recordNotifications(mongo(), [
      row(me, "a"),
      row(me, "b"),
      row(other, "c"),
    ]);
    expect(await markAllRead(mongo(), me)).toBe(2);
    expect(await markAllRead(mongo(), me)).toBe(0);
    expect(await unreadCount(mongo(), me)).toBe(0);
    expect(await unreadCount(mongo(), other)).toBe(1);
  });

  test("a quota notification records the percent and no node", async () => {
    await world();
    const me = fresh();
    const [made] = await recordNotifications(mongo(), [
      { accountId: me, workspaceId, kind: "QUOTA_THRESHOLD", percent: 80 },
    ]);
    expect(made).toMatchObject({ percent: 80, nodeId: null, actorId: null });
  });
});
