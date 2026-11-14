import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { fail, unauthenticated } from "@/i18n/fail";
import {
  FRESH_FOR_MS,
  type Principal,
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
      return payloadOf(await ctx.identity.completeSignUp(token, password));
    },
    signIn: async (_, { input }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(await ctx.identity.signIn(input));
    },
    confirmSecondFactor: async (_, { challenge, code }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(await ctx.identity.confirmSecondFactor(challenge, code));
    },
    recoverSecondFactor: async (_, { challenge, recoveryCode }, ctx) => {
      refuseKey(ctx);
      await ctx.limits.signIn(ctx.ip);
      return payloadOf(
        await ctx.identity.recoverSecondFactor(challenge, recoveryCode),
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
    disableSecondFactor: (_, { code }, ctx) =>
      ctx.identity.disableSecondFactor(ctx.request, requireSession(ctx), code),
  },
};
