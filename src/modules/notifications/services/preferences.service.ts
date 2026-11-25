import type { NotificationsMongo } from "../models";

// Whether an account receives the mail of its notifications: yes until it says
// otherwise.
export async function mailsOn(
  mongo: NotificationsMongo,
  accountId: string,
): Promise<boolean> {
  const row = await mongo.db.mailPreferences.findFirst({ accountId });
  return row === null || row === undefined ? true : row.mails;
}

// The accounts among `accountIds` that turned their mails off.
export async function mailsOff(
  mongo: NotificationsMongo,
  accountIds: readonly string[],
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await mongo.db.mailPreferences.findMany({
    filter: { accountId: { $in: [...accountIds] }, mails: false },
  });
  return new Set(rows.map((row) => row.accountId));
}

// Turns an account's mails on or off: one row per account, made on first use.
export async function setMails(
  mongo: NotificationsMongo,
  accountId: string,
  mails: boolean,
): Promise<boolean> {
  const now = new Date();
  await mongo.db.mailPreferences.raw.updateOne(
    { accountId },
    { $set: { mails, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return mails;
}
