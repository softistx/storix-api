import type { Account } from "@/core/identity";
import { membersMongo } from "@/core/members";
import type { Notify, ShareEvent, UsageEvent } from "@/core/notify";
import { storageOf, workspacesMongo } from "@/core/workspaces";
import type { NotificationDoc } from "../models";
import { notificationsMongo } from "../models";
import type { MailSender } from "../utils";
import { levelOf, type MailContent, type MailKind, mailOf } from "../utils";
import { type NewNotification, recordNotifications } from "./inbox.service";
import { mailsOff } from "./preferences.service";
import { claimLevel } from "./quota.service";
import { administratorsOf, recipientsOfGrant } from "./recipients.service";

export interface NotifierDeps {
  accounts: { byIds(ids: readonly string[]): Promise<Account[]> };
  send: MailSender;
  // A text of the translations in a language, the key itself when there is
  // none (no translations loaded).
  text: (
    language: string,
    key: string,
    params?: Record<string, string | number>,
  ) => string;
  log?: (message: string) => void;
}

// Records the notifications of the events the other modules report
// (`@/core/notify`) and mails them, unless the recipient turned mails off.
// Prepared in the request (recipients, language, text), sent in the
// background (the `MailSender`). It never throws: a notification that fails is
// logged, and the request that caused it stands.
export class Notifier implements Notify {
  readonly #deps: NotifierDeps;

  constructor(deps: NotifierDeps) {
    this.#deps = deps;
  }

  shared(event: ShareEvent): Promise<void> {
    return this.#grant(event, "SHARED", "shared");
  }

  roleChanged(event: ShareEvent): Promise<void> {
    return this.#grant(event, "ROLE_CHANGED", "role-changed");
  }

  usage(event: UsageEvent): Promise<void> {
    return this.#guarded(async () => {
      const { scope } = event;
      const workspaceId = scope.tenant.id;
      const storage = await storageOf(workspacesMongo(scope.core), workspaceId);
      if (storage === undefined) return;
      const level = levelOf(storage.usage.bytes, storage.quotaBytes);
      const core = notificationsMongo(scope.core);
      if (!(await claimLevel(core, workspaceId, level))) return;
      const admins = await administratorsOf(
        membersMongo(scope.core),
        workspaceId,
      );
      await this.#deliver(
        scope.core,
        admins.map(
          (accountId): NewNotification => ({
            accountId,
            workspaceId,
            kind: "QUOTA_THRESHOLD",
            percent: level,
          }),
        ),
        "quota",
        () => ({ workspace: scope.tenant.name, percent: level }),
      );
    });
  }

  #grant(
    event: ShareEvent,
    kind: "SHARED" | "ROLE_CHANGED",
    mail: MailKind,
  ): Promise<void> {
    return this.#guarded(async () => {
      const { scope } = event;
      const workspaceId = scope.tenant.id;
      const recipients = await recipientsOfGrant(
        {
          members: membersMongo(scope.core),
          database: scope.mongo,
          workspaceId,
        },
        event,
      );
      const [actor] = await this.#deps.accounts.byIds([event.actorId]);
      await this.#deliver(
        scope.core,
        recipients.map(
          (accountId): NewNotification => ({
            accountId,
            workspaceId,
            kind,
            actorId: event.actorId,
            nodeId: event.node.id,
            nodeName: event.node.name,
            role: event.role,
          }),
        ),
        mail,
        () => ({
          actor: actor?.name ?? "",
          node: event.node.name,
          role: event.role,
        }),
      );
    });
  }

  // Records the rows, then mails each recipient who has not turned mails off,
  // in their own language.
  async #deliver(
    core: unknown,
    rows: readonly NewNotification[],
    mail: MailKind,
    params: () => Record<string, string | number>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const mongo = notificationsMongo(core);
    const docs = await recordNotifications(mongo, rows);
    const off = await mailsOff(
      mongo,
      docs.map((doc) => doc.accountId),
    );
    const wanted = docs.filter((doc) => !off.has(doc.accountId));
    if (wanted.length === 0) return;
    const accounts = new Map(
      (
        await this.#deps.accounts.byIds([
          ...new Set(wanted.map((doc) => doc.accountId)),
        ])
      ).map((account) => [account.accountId, account]),
    );
    await Promise.all(
      wanted.map((doc) =>
        this.#mail(doc, accounts.get(doc.accountId), mail, params()),
      ),
    );
  }

  async #mail(
    doc: NotificationDoc,
    account: Account | undefined,
    kind: MailKind,
    params: Record<string, string | number>,
  ): Promise<void> {
    if (account === undefined) return;
    const content: MailContent = mailOf(kind, params, (key, values) =>
      this.#deps.text(account.locale, key, values),
    );
    try {
      await this.#deps.send(
        { to: account.email, ...content },
        `notification-${doc.id}`,
      );
    } catch (error) {
      this.#log(`notification mail ${doc.id} not sent: ${String(error)}`);
    }
  }

  async #guarded(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.#log(`notification not made: ${String(error)}`);
    }
  }

  #log(message: string): void {
    (this.#deps.log ?? ((text: string) => console.warn(text)))(message);
  }
}
