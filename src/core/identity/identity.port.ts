// The identity port (plan §3.11): the only thing the rest of the API knows of
// who is signing in. `identity.janus.ts` implements it with @softistx/janus;
// a clavix adapter replaces it later. No type here names janus, and a refusal
// leaves the port already worded as the API's own error (a GraphQLError with
// an `identity.errors.*` or `auth.errors.*` code).

export type Locale = "en" | "fr";

// How long a sign-in or a step-up keeps a session "fresh" for the sensitive
// operations (enrolling, disabling a second factor…).
export const FRESH_FOR_MS = 10 * 60 * 1000;

// Who a request is from. `accountId` is the opaque string every other module
// stores. A session principal has `sessionId`, `sessionExpiresAt` and
// `authenticatedAt`; an API key principal has `apiKeyId` and none of those.
export interface Principal {
  accountId: string;
  email: string;
  name: string;
  locale: Locale;
  emailVerified: boolean;
  // An active second factor.
  secondFactor: boolean;
  // When the session last proved who it is (its sign-in or last step-up).
  authenticatedAt: Date | null;
  sessionId: string | null;
  sessionExpiresAt: Date | null;
  apiKeyId: string | null;
}

// An account as the rest of the API may read it.
export interface Account {
  accountId: string;
  email: string;
  name: string;
  locale: Locale;
  emailVerified: boolean;
}

// What a sign-in step answers.
export type SignInResult =
  | {
      status: "SIGNED_IN";
      token: string;
      expiresAt: Date;
      principal: Principal;
    }
  // The first factor was right and the account has a second one: the code
  // goes to `confirmSecondFactor` (or a recovery code to `recoverSecondFactor`)
  // with `challenge`, before `expiresAt`.
  | { status: "SECOND_FACTOR"; challenge: string; expiresAt: Date }
  // A sign-up was accepted: no session, whether or not the address was taken.
  | { status: "VERIFICATION_SENT" };

export interface StepUpChallenge {
  method: "AUTHENTICATOR" | "EMAIL";
  challenge: string;
  expiresAt: Date;
}

export interface SecondFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number | null;
}

// What the application decides about invitations (src/core/invitations): who
// may do what in a scope (a workspace id) and what a scope is called. `C` is
// the request's context. A thrown GraphQLError (a step-up) is answered as it
// is; `false` is 404 `invitations.errors.not-found`.
export type InvitationAction = "issue" | "resend" | "revoke" | "list";

export interface InvitationHooks<C> {
  authorize(
    action: InvitationAction,
    subject: {
      scope: string;
      input?: { email: string; role: string };
      invitation?: { email: string; role: string };
    },
    ctx: C,
  ): boolean | Promise<boolean>;
  describeScope(scope: string, ctx: C): Promise<{ name: string } | null>;
}

// The resolvers of the invitation fields, opaque to the rest of the API: the
// module hands each field's arguments and the request's context to them.
export type InvitationResolverMap = Record<
  string,
  Record<string, (...args: unknown[]) => unknown>
>;

export interface Identity {
  // The principal of a request, or null when anonymous. A key-shaped bearer
  // is read as a key only with `apiKey: true`; without it, it is anonymous.
  // A store that cannot answer rejects with `identity.errors.unavailable`.
  authenticate(
    request: Request,
    options?: { apiKey?: boolean },
  ): Promise<Principal | null>;

  accounts: {
    // The accounts of these ids, those found only (a DataLoader source).
    byIds(ids: readonly string[]): Promise<Account[]>;
    byEmail(email: string): Promise<Account | null>;
  };

  // Refuses (403 `auth.errors.step-up-required`) a principal whose session
  // proved who it is more than `maxAgeMs` ago. A key is never fresh.
  assertFresh(principal: Principal, maxAgeMs?: number): void;

  // For the secrets of other modules (link passwords, token hashes).
  hasher: {
    hash(plain: string): Promise<string>;
    verify(plain: string, hash: string): Promise<boolean>;
  };

  signUp(input: {
    email: string;
    name: string;
    locale: Locale;
  }): Promise<SignInResult>;
  completeSignUp(token: string, password: string): Promise<SignInResult>;
  signIn(input: { email: string; password: string }): Promise<SignInResult>;
  confirmSecondFactor(challenge: string, code: string): Promise<SignInResult>;
  recoverSecondFactor(
    challenge: string,
    recoveryCode: string,
  ): Promise<SignInResult>;
  signOut(request: Request): Promise<boolean>;
  requestPasswordReset(request: Request, email: string): Promise<true>;
  resetPassword(token: string, password: string): Promise<true>;

  requestStepUp(
    request: Request,
    principal: Principal,
  ): Promise<StepUpChallenge>;
  // Answers until when the session counts as fresh.
  confirmStepUp(
    request: Request,
    principal: Principal,
    challenge: string,
    code: string,
  ): Promise<Date>;

  enrolSecondFactor(
    principal: Principal,
  ): Promise<{ secret: string; uri: string }>;
  activateSecondFactor(
    principal: Principal,
    code: string,
  ): Promise<{ recoveryCodes: string[] }>;
  regenerateRecoveryCodes(
    principal: Principal,
    code: string,
  ): Promise<{ recoveryCodes: string[] }>;
  // `code` is a code of the app or, for a lost phone, a recovery code.
  disableSecondFactor(
    request: Request,
    principal: Principal,
    code: string,
  ): Promise<true>;
  secondFactorStatus(principal: Principal): Promise<SecondFactorStatus>;

  // The resolvers of the invitation fields (`invitations`, `issueInvitation`,
  // `resendInvitation`, `revokeInvitation`, `invitationPreview`,
  // `acceptInvitation`; their SDL is `invitationTypeDefs`) over `hooks`. An accepted invitation calls the `onAccepted`
  // the identity was built with.
  invitations: {
    resolvers<C extends { viewer: Principal | null }>(
      hooks: InvitationHooks<C>,
    ): InvitationResolverMap;
  };

  // Creates the collections, validators and indexes the identity stores keep
  // (a deployment step, `bun run db:sync`; at boot outside production). Says
  // what it changed; a second run sends nothing.
  syncStores(options?: { dryRun?: boolean }): Promise<unknown[]>;

  // Resolves when the mails started in the background have been sent (specs).
  settled(): Promise<void>;
}
