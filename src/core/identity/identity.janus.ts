import {
  type Background,
  background,
  type Clock,
  type MailConfig,
  type PasswordHasher,
  scryptHasher,
  systemClock,
} from "@softistx/janus";
import {
  createMongoAdapter,
  createMongoApiKeys,
  createMongoInvitations,
  syncMongoAdapter,
  syncMongoApiKeys,
  syncMongoInvitations,
} from "@softistx/janus-mongo";
import type { Mailer } from "@softistx/mail";
import type { Db } from "mongodb";
import { invitationStateReader } from "./identity.invitation-state";
import { createInvitationResolvers } from "./identity.invitations";
import type { Account, Identity } from "./identity.port";
import { type Accepted, createAccounts } from "./janus.accounts";

import { authCall } from "./janus.errors";
import { createMail, securityNotices } from "./janus.mail";
import { secondFactorFlows } from "./janus.second-factor";
import { type AccountUser, localeOf, principalOf } from "./janus.shared";
import { signInFlows } from "./janus.sign-in";
import { signUpFlows } from "./janus.sign-up";
import { stepUpFlows } from "./janus.step-up";

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
  // Adds an account that accepted an invitation to its scope (a workspace).
  // Runs inside janus's accept, after the account exists: a throw refuses it.
  onAcceptedInvitation: (accepted: Accepted) => Promise<void>;
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
// The janus parts one identity is made of, wired once from its options.
function assemble(options: IdentityOptions) {
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
  const invitationStore = createMongoInvitations(options.db);
  const accounts = createAccounts({
    store,
    apiKeys: createMongoApiKeys(options.db),
    clock,
    hasher,
    totpKeys: options.totpKeys,
    events: notices,
    ...(options.mail && { mail: options.mail }),
    invitations: {
      store: invitationStore,
      onAccepted: options.onAcceptedInvitation,
    },
  });
  return { accounts, mail, runner, hasher, invitationStore, clock };
}

export function createJanusIdentity(options: IdentityOptions): Identity {
  const { accounts, mail, runner, hasher, invitationStore, clock } =
    assemble(options);
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
        authCall(async () =>
          (await accounts.user.findMany(ids)).map(accountOf),
        ),
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

    ...signUpFlows(deps),
    ...signInFlows(deps),
    ...stepUpFlows(deps),
    ...secondFactorFlows(deps),

    invitations: {
      resolvers: (hooks) =>
        createInvitationResolvers(accounts, mail, options.uiOrigin, hooks),
      stateOf: invitationStateReader(invitationStore, () => clock.now()),
    },

    // The keys and the invitations are opt-in ports: not part of
    // syncMongoAdapter.
    syncStores: async (syncOptions = {}) => [
      ...(await syncMongoAdapter(options.db, syncOptions)),
      ...(await syncMongoApiKeys(options.db, syncOptions)),
      ...(await syncMongoInvitations(options.db, syncOptions)),
    ],

    settled: () => runner.settled(),
  } satisfies Identity;
}
