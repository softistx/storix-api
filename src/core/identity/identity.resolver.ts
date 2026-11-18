import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { fail, unauthenticated } from "@/i18n/fail";
import {
  FRESH_FOR_MS,
  type Principal,
  type SignInOptions,
  type SignInResult,
} from "./identity.port";

// An operation of the account (sign-in, a second factor, a password reset…) is
// never called with a personal API key: a key is for the API's data, so a
// stolen one cannot change who the account is. 401
// `auth.errors.api-key-not-accepted`.
function refuseKey(ctx: Context) {
  if (ctx.viewer?.apiKeyId != null) {
    throw fail("auth.errors.api-key-not-accepted", { status: 401 });
  }
}

// The caller, or the 401 of an anonymous request.
export function requireViewer(ctx: Context): Principal {
  if (!ctx.viewer) throw unauthenticated();
  return ctx.viewer;
}

// The signed-in person behind a session (not a key) for the operations of the
// account itself.
export function requireSession(ctx: Context): Principal {
  refuseKey(ctx);
  return requireViewer(ctx);
}

// What the session list shows for the sign-in: the client's User-Agent.
const deviceOf = (ctx: Context): SignInOptions => {
  const agent = ctx.request.headers.get("user-agent")?.trim();
  return agent ? { deviceLabel: agent } : {};
};

export const viewerOf = (principal: Principal) => ({
  id: principal.accountId,
  email: principal.email,
  name: principal.name,
  emailVerified: principal.emailVerified,
  locale: principal.locale === "fr" ? ("FR" as const) : ("EN" as const),
  hasSecondFactor: principal.secondFactor,
  sessionExpiresAt: principal.sessionExpiresAt,
  sessionConfirmedUntil:
    principal.authenticatedAt === null
      ? null
      : new Date(principal.authenticatedAt.getTime() + FRESH_FOR_MS),
  apiKeyId: principal.apiKeyId,
});

const payloadOf = (result: SignInResult) => {
  switch (result.status) {
    case "SIGNED_IN":
      return {
        status: result.status,
        token: result.token,
        expiresAt: result.expiresAt,
        viewer: viewerOf(result.principal),
      };
    case "SECOND_FACTOR":
      return {
        status: result.status,
        challenge: result.challenge,
        expiresAt: result.expiresAt,
      };
    case "VERIFICATION_SENT":
      return { status: result.status };
  }
};

// The identity operations, over the port the request's context carries. Each
// refuses a personal API key (`viewer` alone answers one); the anonymous ones
// that anyone may call count the client address first.
export const identityResolvers: Resolvers = {
  Query: {
    viewer: (_, __, ctx) => (ctx.viewer ? viewerOf(ctx.viewer) : null),
    secondFactorStatus: (_, __, ctx) =>
      ctx.identity.secondFactorStatus(requireSession(ctx)),
    sessions: (_, __, ctx) => ctx.identity.sessions(requireSession(ctx)),
  },
  Mutation: {
    signUp: async (_, { input }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signUp(ctx.ip);
      return payloadOf(
        await ctx.identity.signUp({
          ...input,
          locale: input.locale === "FR" ? "fr" : "en",
        }),
      );
    },
    completeSignUp: async (_, { token, password }, ctx) => {
      refuseKey(ctx);
      return payloadOf(
        await ctx.identity.completeSignUp(token, password, deviceOf(ctx)),
      );
    },
    signIn: async (_, { input }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(await ctx.identity.signIn(input, deviceOf(ctx)));
    },
    confirmSecondFactor: async (_, { challenge, code }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(
        await ctx.identity.confirmSecondFactor(challenge, code, deviceOf(ctx)),
      );
    },
    recoverSecondFactor: async (_, { challenge, recoveryCode }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(
        await ctx.identity.recoverSecondFactor(
          challenge,
          recoveryCode,
          deviceOf(ctx),
        ),
      );
    },
    signOut: (_, __, ctx) => {
      refuseKey(ctx);
      return ctx.identity.signOut(ctx.request);
    },
    requestPasswordReset: async (_, { email }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.passwordReset(ctx.ip);
      return ctx.identity.requestPasswordReset(ctx.request, email);
    },
    resetPassword: (_, { token, password }, ctx) => {
      refuseKey(ctx);
      return ctx.identity.resetPassword(token, password);
    },
    requestStepUp: (_, __, ctx) =>
      ctx.identity.requestStepUp(ctx.request, requireSession(ctx)),
    confirmStepUp: (_, { challenge, code }, ctx) =>
      ctx.identity.confirmStepUp(
        ctx.request,
        requireSession(ctx),
        challenge,
        code,
      ),
    enrolSecondFactor: (_, __, ctx) =>
      ctx.identity.enrolSecondFactor(requireSession(ctx)),
    activateSecondFactor: (_, { code }, ctx) =>
      ctx.identity.activateSecondFactor(requireSession(ctx), code),
    regenerateRecoveryCodes: (_, { code }, ctx) =>
      ctx.identity.regenerateRecoveryCodes(requireSession(ctx), code),
    changePassword: async (_, { current, next }, ctx) => {
      const principal = requireSession(ctx);
      // The current password is guessable here: count the address like a
      // sign-in (janus counts the account's wrong guesses too).
      await ctx.limits.signIn(ctx.ip);
      return ctx.identity.changePassword(principal, { current, next });
    },
    revokeSession: (_, { id }, ctx) =>
      ctx.identity.revokeSession(requireSession(ctx), id),
    revokeOtherSessions: (_, __, ctx) =>
      ctx.identity.revokeOtherSessions(requireSession(ctx)),
    disableSecondFactor: async (_, { code }, ctx) => {
      const principal = requireSession(ctx);
      // janus throttles the account's code tries; the per-address limit stays too.
      await ctx.limits.signIn(ctx.ip);
      return ctx.identity.disableSecondFactor(ctx.request, principal, code);
    },
  },
};
