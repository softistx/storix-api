import { FRESH_FOR_MS, type Principal } from "../identity.port";

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
