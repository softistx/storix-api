import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../test/roles.harness";
import { SHARE } from "../../../test/shares.harness";

const LIST = `query($first: Int!, $after: String, $unreadOnly: Boolean!) { notifications(first: $first, after: $after, unreadOnly: $unreadOnly) { totalCount pageInfo { endCursor hasNextPage } nodes { id kind readAt } } }`;
const COUNT = `{ unreadNotificationCount }`;
const READ = `mutation($id: ID!) { markNotificationRead(id: $id) { id readAt } }`;
const READ_ALL = `mutation { markAllNotificationsRead }`;
const PREFS = `{ mailPreferences { mails } }`;
const SET_PREFS = `mutation($mails: Boolean!) { setMailPreferences(mails: $mails) { mails } }`;

// A guest who was shared two folders' worth of notifications by the owner.
async function inbox() {
  const a = await roleArea();
  const guest = await a.w.join(a.workspace, "MEMBER");
  const other = await a.w.join(a.workspace, "MEMBER");
  const give = async (to: typeof guest, name: string) => {
    const folder = await a.owner.folder(a.root.id, name);
    const done = await a.w.send(a.workspace.owner, SHARE, {
      workspace: a.workspace.id,
      variables: {
        id: folder.id,
        principal: { type: "MEMBER", id: to.memberId },
        role: "VIEWER",
      },
    });
    expect(done.errors).toBeUndefined();
  };
  await give(guest, "One");
  await give(guest, "Two");
  await give(guest, "Three");
  await give(other, "Theirs");
  const ask = (
    who: typeof guest,
    query: string,
    variables?: Record<string, unknown>,
  ) => a.w.send(who.user, query, variables && { variables });
  return { a, guest, other, ask };
}

describe("the inbox over GraphQL", () => {
  test("every operation refuses a caller with no session", async () => {
    const { a } = await inbox();
    const queries: [string, Record<string, unknown>?][] = [
      [LIST, { first: 5, unreadOnly: false }],
      [COUNT],
      [PREFS],
      [READ, { id: "6563f8f0a1b2c3d4e5f60700" }],
      [READ_ALL],
      [SET_PREFS, { mails: false }],
    ];
    for (const [query, variables] of queries) {
      const result = await a.w.send(null, query, variables && { variables });
      expect(a.w.codeOf(result)).toBe("auth.errors.unauthenticated");
    }
  });

  test("lists the caller's own notifications, newest first, with a cursor", async () => {
    const { a, guest, ask } = await inbox();
    const first = await ask(guest, LIST, { first: 2, unreadOnly: false });
    const page = first.data?.["notifications"];
    expect(page.totalCount).toBe(3);
    expect(page.nodes).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = await ask(guest, LIST, {
      first: 2,
      after: page.pageInfo.endCursor,
      unreadOnly: false,
    });
    expect(next.data?.["notifications"].nodes).toHaveLength(1);
    expect(next.data?.["notifications"].pageInfo.hasNextPage).toBe(false);
    expect(a.w.codeOf(next)).toBeUndefined();
  });

  test("marking one read lowers the unread count, and another account's id is a 404", async () => {
    const { a, guest, other, ask } = await inbox();
    expect((await ask(guest, COUNT)).data?.["unreadNotificationCount"]).toBe(3);
    const list = await ask(guest, LIST, { first: 10, unreadOnly: false });
    const id = list.data?.["notifications"].nodes[0].id as string;
    const read = await ask(guest, READ, { id });
    expect(read.data?.["markNotificationRead"].readAt).not.toBeNull();
    expect((await ask(guest, COUNT)).data?.["unreadNotificationCount"]).toBe(2);
    const unread = await ask(guest, LIST, { first: 10, unreadOnly: true });
    expect(unread.data?.["notifications"].totalCount).toBe(2);

    const foreign = await ask(other, READ, { id });
    expect(a.w.codeOf(foreign)).toBe("notifications.errors.not-found");
    expect((await ask(other, COUNT)).data?.["unreadNotificationCount"]).toBe(1);
  });

  test("marking all read answers how many it changed", async () => {
    const { guest, other, ask } = await inbox();
    expect(
      (await ask(guest, READ_ALL)).data?.["markAllNotificationsRead"],
    ).toBe(3);
    expect(
      (await ask(guest, READ_ALL)).data?.["markAllNotificationsRead"],
    ).toBe(0);
    expect((await ask(guest, COUNT)).data?.["unreadNotificationCount"]).toBe(0);
    expect((await ask(other, COUNT)).data?.["unreadNotificationCount"]).toBe(1);
  });

  test("the mail preference is on by default and set per account", async () => {
    const { guest, other, ask } = await inbox();
    expect((await ask(guest, PREFS)).data?.["mailPreferences"]).toEqual({
      mails: true,
    });
    await ask(guest, SET_PREFS, { mails: false });
    expect((await ask(guest, PREFS)).data?.["mailPreferences"]).toEqual({
      mails: false,
    });
    expect((await ask(other, PREFS)).data?.["mailPreferences"]).toEqual({
      mails: true,
    });
  });

  test("the first page of an inbox is bounded", async () => {
    const { a, guest, ask } = await inbox();
    const result = await ask(guest, LIST, { first: 101, unreadOnly: false });
    expect(result.errors).toBeDefined();
    expect(a.w.codeOf(result)).toBeDefined();
  });
});
