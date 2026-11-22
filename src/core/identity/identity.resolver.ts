import type { Resolvers } from "@/generated/graphql/resolvers";
import {
  deviceOf,
  payloadOf,
  refuseKey,
  requireSession,
  viewerOf,
} from "./utils";

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
