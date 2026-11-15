import { graphqlClient } from "@alxia/graphql/testing";
import { fixedClock, scryptHasher } from "@softistx/janus";
import { totpCode } from "@softistx/janus/testing";
import {
  createMongoAdapter,
  createMongoApiKeys,
  createMongoInvitations,
} from "@softistx/janus-mongo";
import { createMemoryMailer } from "@softistx/mail";
import { createApp } from "@/app";
import { connection } from "@/config/db";
import { clientHeader } from "@/http/csrf";
import type { Limits } from "@/http/rate-limits";
import { createJanusIdentity, type IdentityOptions } from "./identity.janus";
import { createAccounts } from "./janus.accounts";

export const PASSWORD = "correct horse battery staple";

// An identity over its own database on the spec server, an in-memory mailer, a
// fixed clock and a cheap hasher, and the app that serves it: what the specs
// of the identity flows share. Every call gets a database of its own, so specs
// never see each other's accounts.
export async function harness(
  options: Partial<IdentityOptions> & {
    limits?: Limits;
    media?: NonNullable<Parameters<typeof createApp>[0]>["media"];
  } = {},
) {
  const { limits, media, ...identityOptions } = options;
  const mailer = createMemoryMailer();
  const clock = fixedClock(new Date("2026-11-14T12:00:00Z"));
  const db = connection.client.db(`identity_spec_${crypto.randomUUID()}`);
  const identity = createJanusIdentity({
    db,
    mailer,
    uiOrigin: "https://storix.test",
    mailFrom: "noreply@storix.test",
    clock,
    hasher: scryptHasher({ cost: 10 }),
    totpKeys: [
      { id: "spec", key: "c3RvcmF4LXNwZWMtdG90cC1rZXktMzItYnl0ZXMhISE" },
    ],
    mail: { throttle: false },
    onAcceptedInvitation: async () => undefined,
    ...identityOptions,
  });
  if (!options.db) await identity.syncStores();
  const app = createApp({
    identity,
    ...(limits && { limits }),
    ...(media && { media }),
  });
  const client = graphqlClient(app, { headers: { [clientHeader]: "spec" } });

  let sequence = 0;
  const email = () =>
    `person-${++sequence}-${crypto.randomUUID().slice(0, 8)}@storix.test`;

  // The mails sent so far to an address, newest last.
  const mailsTo = (address: string) =>
    mailer.sent.filter((mail) =>
      [mail.to]
        .flat()
        .some((to) => (typeof to === "string" ? to : to.address) === address),
    );
  // The token of the link in the newest mail to an address.
  const tokenFor = (address: string) => {
    const mail = mailsTo(address).at(-1);
    const token = /[?&]token=([^\s&"'<>)]+)/.exec(mail?.text ?? "")?.[1];
    if (!token) throw new Error(`no link token in a mail to ${address}`);
    return decodeURIComponent(token);
  };
  // The code of the invitation link in the newest mail to an address.
  const invitationCodeFor = (address: string) => {
    const code = /\/invitations\/accept#([A-Za-z0-9_-]{43})/.exec(
      mailsTo(address).at(-1)?.text ?? "",
    )?.[1];
    if (!code) throw new Error(`no invitation code in a mail to ${address}`);
    return code;
  };
  // The six-digit code in the newest mail to an address.
  const codeFor = (address: string) => {
    const code = /\b(\d{6})\b/.exec(mailsTo(address).at(-1)?.text ?? "")?.[1];
    if (!code) throw new Error(`no code in a mail to ${address}`);
    return code;
  };

  // Signs up, follows the link and chooses the password: a verified account
  // with a session.
  async function account(address = email(), name = "Ada") {
    await identity.signUp({ email: address, name, locale: "en" });
    await identity.settled();
    const result = await identity.completeSignUp(tokenFor(address), PASSWORD);
    if (result.status !== "SIGNED_IN") throw new Error("not signed in");
    const headers = { authorization: `Bearer ${result.token}` };
    return {
      email: address,
      token: result.token,
      headers,
      principal: result.principal,
    };
  }

  // Turns the second factor on for an account (its authenticator code is the
  // current one of the fixed clock): the ten recovery codes.
  async function enableSecondFactor(user: {
    principal: Parameters<typeof identity.enrolSecondFactor>[0];
  }) {
    const { secret } = await identity.enrolSecondFactor(user.principal);
    const { recoveryCodes } = await identity.activateSecondFactor(
      user.principal,
      totpCode(secret, clock.now()),
    );
    return recoveryCodes;
  }

  // A personal API key of an account, made through a second janus over the same
  // stores (the port has no key operation yet): its token, shown once.
  function keysOf() {
    return createAccounts({
      store: createMongoAdapter(db),
      apiKeys: createMongoApiKeys(db),
      clock,
      hasher: scryptHasher({ cost: 10 }),
      totpKeys: [
        { id: "spec", key: "c3RvcmF4LXNwZWMtdG90cC1rZXktMzItYnl0ZXMhISE" },
      ],
      events: async () => undefined,
      invitations: {
        store: createMongoInvitations(db),
        onAccepted: async () => undefined,
      },
    });
  }

  async function apiKey(user: { token: string }) {
    const keys = keysOf();
    const current = await keys.authenticate(
      new Request("http://localhost/", {
        headers: { authorization: `Bearer ${user.token}` },
      }),
    );
    if (!current) throw new Error("no session");
    const created = await keys.apiKeys.create(current, {
      name: "spec",
      lifetime: "30d",
    });
    return created.token;
  }

  // Deactivates an account (a second janus over the same stores, as `apiKey`).
  async function deactivate(accountId: string) {
    await keysOf().user.setActive({ id: accountId }, false);
  }

  // Revokes every key of an account.
  async function revokeKeys(user: { principal: { accountId: string } }) {
    await keysOf().apiKeys.revokeAll({ id: user.principal.accountId });
  }

  const request = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/graphql", { method: "POST", headers });

  return {
    identity,
    mailer,
    clock,
    app,
    client,
    email,
    mailsTo,
    tokenFor,
    codeFor,
    invitationCodeFor,
    account,
    enableSecondFactor,
    apiKey,
    deactivate,
    revokeKeys,
    request,
  };
}
