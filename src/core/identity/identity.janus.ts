import {
  type Clock,
  type MailConfig,
  type PasswordHasher,
  scryptHasher,
  systemClock,
} from "@softistx/janus";
import {
  createMongoAdapter,
  createMongoApiKeys,
  syncMongoAdapter,
  syncMongoApiKeys,
} from "@softistx/janus-mongo";
import type { Mailer } from "@softistx/mail";
import type { Db } from "mongodb";
import type { Account, Identity } from "./identity.port";
import { createAccounts } from "./janus.accounts";
import { type Background, background } from "./janus.background";
import { authCall } from "./janus.errors";
import { createMail, securityNotices } from "./janus.mail";
import { secondFactorFlows } from "./janus.second-factor";
import { type AccountUser, localeOf, principalOf } from "./janus.shared";
import { signInFlows } from "./janus.sign-in";

export interface IdentityOptions {
  // The database janus keeps its users, sessions, tokens and keys in.
  db: Db;
  mailer: Mailer;
  // storix-ui's origin: every link of a mail starts with it.
  uiOrigin: string;
  mailFrom: string;
  // `fixedClock()` in specs: sessions and links expire by it.
  clock?: Clock;
  // scrypt at OWASP's cost by default; a spec passes a cheap one.
  hasher?: PasswordHasher;
  // The keys that seal the TOTP secrets (env.TOTP_KEYS): the first seals,
  // every one opens.
  totpKeys: readonly [
    { id: string; key: string },
    ...{ id: string; key: string }[],
  ];
  // janus's mail throttle; a spec that is not about it passes
  // `{ throttle: false }`.
  mail?: MailConfig;
  background?: Background;
}

const accountOf = (user: AccountUser): Account => ({
  accountId: user.id,
  email: user.email,
  name: user.name,
  locale: localeOf(user),
  emailVerified: user.emailVerified,
});

// The identity port over janus: the one place that imports it (with
// `src/config/auth.ts`, which builds it). `deps:check` refuses a janus import
// anywhere else.
export function createJanusIdentity(options: IdentityOptions): Identity {
  const clock = options.clock ?? systemClock;
  const store = createMongoAdapter(options.db);
  const mail = createMail({
    mailer: options.mailer,
    from: { name: "storix", address: options.mailFrom },
    uiOrigin: options.uiOrigin,
    clock,
  });
  const runner = options.background ?? background();
  const notices = securityNotices(mail, () => accounts);
  const hasher = options.hasher ?? scryptHasher();
  const accounts = createAccounts({
    store,
    apiKeys: createMongoApiKeys(options.db),
    clock,
    hasher,
    totpKeys: options.totpKeys,
    events: notices,
    ...(options.mail && { mail: options.mail }),
  });
  const deps = { accounts, mail, background: runner, clock };

  return {
    // `apiKey: true` makes a key-shaped bearer authenticate as its owner (janus
    // reads keys from `Authorization: Bearer` only).
    async authenticate(request, { apiKey = false } = {}) {
      const current = await authCall(() =>
        apiKey
          ? accounts.authenticate(request, { apiKey: true })
          : accounts.authenticate(request),
      );
      if (!current) return null;
      return current.via === "apiKey"
        ? principalOf(current.user, undefined, current.apiKey.id)
        : principalOf(current.user, current.session);
    },

    accounts: {
      byIds: (ids) =>
        authCall(async () => {
          const found = await Promise.all(
            ids.map((id) => accounts.user.find(id)),
          );
          return found.flatMap((user) => (user ? [accountOf(user)] : []));
        }),
      byEmail: (email) =>
        authCall(async () => {
          const user = await accounts.user.findByEmail(email);
          return user ? accountOf(user) : null;
        }),
    },

    hasher: {
      hash: (plain) => hasher.hash(plain),
      verify: (plain, hash) => hasher.verify(plain, hash),
    },

    ...signInFlows(deps),
    ...secondFactorFlows(deps),

    // The keys are an opt-in port: not part of syncMongoAdapter.
    syncStores: async (syncOptions = {}) => [
      ...(await syncMongoAdapter(options.db, syncOptions)),
      ...(await syncMongoApiKeys(options.db, syncOptions)),
    ],

    settled: () => runner.settled(),
  } satisfies Identity;
}
