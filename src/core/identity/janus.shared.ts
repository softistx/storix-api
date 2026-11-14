import type {
  Background,
  Clock,
  SecondFactorRequired,
  Session,
  SignedIn,
} from "@softistx/janus";
import { parseAcceptLanguage, pickLocale } from "@softistx/mail";
import type { Locale, Principal, SignInResult } from "./identity.port";
import type { Accounts } from "./janus.accounts";

import type { Mail } from "./janus.mail";

// What the flows of the adapter share.
export interface Deps {
  accounts: Accounts;
  mail: Mail;
  background: Background;
  clock: Clock;
}

// A janus account of the `user` type, as far as the adapter reads it.
export interface AccountUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasSecondFactor: boolean;
  locale?: Locale | undefined;
}

export const localeOf = (user: { locale?: Locale | undefined }): Locale =>
  user.locale ?? "en";

// The language a mail is written in: the request's Accept-Language among
// English and French, else English.
export function mailLocaleOf(request: Request): Locale {
  return pickLocale(
    parseAcceptLanguage(request.headers.get("accept-language")),
    ["en", "fr"] as const,
    "en",
  );
}

// A janus account as the port's principal, with the session it signed in with
// or the API key it came in with (a key has no session).
export const principalOf = (
  user: AccountUser,
  session?: Pick<Session, "expiresAt" | "authenticatedAt"> & { id?: string },
  apiKeyId: string | null = null,
): Principal => ({
  accountId: user.id,
  email: user.email,
  name: user.name,
  locale: localeOf(user),
  emailVerified: user.emailVerified,
  secondFactor: user.hasSecondFactor,
  authenticatedAt: session?.authenticatedAt ?? null,
  sessionId: session?.id ?? null,
  sessionExpiresAt: session?.expiresAt ?? null,
  apiKeyId,
});

export const verificationSent: SignInResult = { status: "VERIFICATION_SENT" };

// What a janus sign-in answers as the port's result: the challenge of a second
// factor still to give, else the session opened.
export function resultOf(
  result: SignedIn<AccountUser> | SecondFactorRequired,
): SignInResult {
  if (result.status === "secondFactor") {
    return {
      status: "SECOND_FACTOR",
      challenge: result.challenge,
      expiresAt: result.expiresAt,
    };
  }
  return {
    status: "SIGNED_IN",
    token: result.token,
    expiresAt: result.session.expiresAt,
    principal: principalOf(result.user, result.session),
  };
}
