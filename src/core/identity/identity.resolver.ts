import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { unauthenticated } from "@/i18n/fail";
import type { Principal, SignInResult } from "./identity.port";
import { FRESH_FOR_MS } from "./janus.second-factor";

// The caller, or the 401 of an anonymous request.
export function requireViewer(ctx: Context): Principal {
  if (!ctx.viewer) throw unauthenticated();
  return ctx.viewer;
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

// The identity operations, over the port the request's context carries.
export const identityResolvers: Resolvers = {
  Query: {
    viewer: (_, __, ctx) => (ctx.viewer ? viewerOf(ctx.viewer) : null),
    secondFactorStatus: (_, __, ctx) =>
      ctx.identity.secondFactorStatus(requireViewer(ctx)),
  },
  Mutation: {
    signUp: async (_, { input }, ctx) =>
      payloadOf(
        await ctx.identity.signUp({
          ...input,
          locale: input.locale === "FR" ? "fr" : "en",
        }),
      ),
    completeSignUp: async (_, { token, password }, ctx) =>
      payloadOf(await ctx.identity.completeSignUp(token, password)),
    resendVerificationEmail: (_, __, ctx) =>
      ctx.identity.resendVerificationEmail(requireViewer(ctx)),
    signIn: async (_, { input }, ctx) =>
      payloadOf(await ctx.identity.signIn(input)),
    confirmSecondFactor: async (_, { challenge, code }, ctx) =>
      payloadOf(await ctx.identity.confirmSecondFactor(challenge, code)),
    recoverSecondFactor: async (_, { challenge, recoveryCode }, ctx) =>
      payloadOf(
        await ctx.identity.recoverSecondFactor(challenge, recoveryCode),
      ),
    signOut: (_, __, ctx) => ctx.identity.signOut(ctx.request),
    requestPasswordReset: (_, { email }, ctx) =>
      ctx.identity.requestPasswordReset(ctx.request, email),
    resetPassword: (_, { token, password }, ctx) =>
      ctx.identity.resetPassword(token, password),
    requestStepUp: (_, __, ctx) =>
      ctx.identity.requestStepUp(ctx.request, requireViewer(ctx)),
    confirmStepUp: (_, { challenge, code }, ctx) =>
      ctx.identity.confirmStepUp(
        ctx.request,
        requireViewer(ctx),
        challenge,
        code,
      ),
    enrolSecondFactor: (_, __, ctx) =>
      ctx.identity.enrolSecondFactor(requireViewer(ctx)),
    activateSecondFactor: (_, { code }, ctx) =>
      ctx.identity.activateSecondFactor(requireViewer(ctx), code),
    regenerateRecoveryCodes: (_, { code }, ctx) =>
      ctx.identity.regenerateRecoveryCodes(requireViewer(ctx), code),
    disableSecondFactor: (_, { code }, ctx) =>
      ctx.identity.disableSecondFactor(ctx.request, requireViewer(ctx), code),
  },
};
