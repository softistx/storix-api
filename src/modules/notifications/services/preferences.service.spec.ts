import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { notificationsMongo } from "../models";
import { mailsOff, mailsOn, setMails } from "./preferences.service";

const mongo = () => notificationsMongo(tenancy.core);
const fresh = () => `acct-${crypto.randomUUID()}`;

describe("the mail preference of an account", () => {
  test("mails are on until the account says otherwise", async () => {
    await world();
    expect(await mailsOn(mongo(), fresh())).toBe(true);
  });

  test("turning them off and on again is kept, one row per account", async () => {
    await world();
    const me = fresh();
    expect(await setMails(mongo(), me, false)).toBe(false);
    expect(await mailsOn(mongo(), me)).toBe(false);
    await setMails(mongo(), me, true);
    expect(await mailsOn(mongo(), me)).toBe(true);
    expect(await mongo().db.mailPreferences.count({ accountId: me })).toBe(1);
  });

  test("mailsOff names only the accounts that turned them off", async () => {
    await world();
    const off = fresh();
    const on = fresh();
    await setMails(mongo(), off, false);
    await setMails(mongo(), on, true);
    expect([...(await mailsOff(mongo(), [off, on, fresh()]))]).toEqual([off]);
    expect((await mailsOff(mongo(), [])).size).toBe(0);
  });
});
