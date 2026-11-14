import {
  type Clock,
  janus,
  type MailConfig,
  type PasswordHasher,
  scryptHasher,
  type UserEvent,
} from "@softistx/janus";
import type {
  createMongoAdapter,
  createMongoApiKeys,
} from "@softistx/janus-mongo";
import { z } from "zod";

type Store = ReturnType<typeof createMongoAdapter>;

// What an account holds beside what janus sets (id, emailVerified,
// hasPassword…): the e-mail it signs in with, a name for the mails, and the
// language its mails and notices are written in.
const Account = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200),
  locale: z.enum(["en", "fr"]).optional(),
});

// The shortest password janus accepts, set once so that completing a sign-up
// checks it before it spends a token.
export const PASSWORD_MIN_LENGTH = 8;

// The start of every API key: a leaked key is recognised and scanned for by it.
export const API_KEY_PREFIX = "stx_";

// janus with storix's one account type, `user`: global (a person belongs to
// workspaces through members, not through their account), signing in by
// e-mail and password, with an optional TOTP second factor whose secrets are
// sealed with `totpKeys`. A session lasts 7 days and slides: once a day has
// passed since it was opened or last renewed, janus moves its end to a whole 7
// days from now. Personal keys (30, 90 or 365 days, 10 at most per account)
// are accepted only where a call asks (`authenticate(request, { apiKey: true })`).
export function createAccounts(options: {
  store: Store;
  apiKeys: ReturnType<typeof createMongoApiKeys>;
  clock: Clock;
  hasher: PasswordHasher | undefined;
  totpKeys: readonly [
    { id: string; key: string },
    ...{ id: string; key: string }[],
  ];
  events: (event: UserEvent) => Promise<void>;
  mail?: MailConfig;
}) {
  return janus({
    users: {
      user: {
        schema: Account,
        password: { login: "email", minLength: PASSWORD_MIN_LENGTH },
        session: { lifespan: "7d", renewAfter: "1d" },
      },
    },
    store: options.store.store,
    relations: options.store.relations,
    hasher: options.hasher ?? scryptHasher(),
    clock: options.clock,
    secondFactor: { issuer: "storix", keys: options.totpKeys },
    events: options.events,
    apiKeys: {
      store: options.apiKeys,
      prefix: API_KEY_PREFIX,
      lifetimes: ["30d", "90d", "365d"],
      maxActive: 10,
    },
    ...(options.mail && { mail: options.mail }),
  });
}

export type Accounts = ReturnType<typeof createAccounts>;
