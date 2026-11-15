import type { Clock, UserEvent } from "@softistx/janus";
import { type JanusMail, janusMail } from "@softistx/janus-mail";
import type { Mailer } from "@softistx/mail";
import type { Accounts } from "./janus.accounts";

export type Mail = JanusMail<"en" | "fr">;

// The brand of the mails: the name in the footer and the button colour,
// janus-mail nudging it to AA in light and dark.
export const mailBrand = { name: "storix", color: "#0e7490" };

// The links the mails carry, to pages of storix-ui that spend nothing: each
// posts its token back to the API from a button (a mail scanner follows a
// link, so a GET never consumes it). The paths are fixed; the UI never renames
// them alone.
export function mailLinks(uiOrigin: string) {
  const at = (path: string, token?: string) =>
    token === undefined
      ? `${uiOrigin}${path}`
      : `${uiOrigin}${path}?token=${encodeURIComponent(token)}`;
  return {
    resetPassword: (token: string) => at("/auth/reset-password", token),
    verifyEmail: (token: string) => at("/auth/verify-email", token),
    magicLink: (token: string) => at("/auth/magic-link", token),
    secureAccount: () => at("/account/security"),
    getStarted: () => at("/"),
  };
}

// janus-mail over the app's mailer. English is the product's language, so it
// is the fallback of a mail whose recipient names none.
export function createMail(options: {
  mailer: Mailer;
  from: { name: string; address: string };
  uiOrigin: string;
  clock: Clock;
}): Mail {
  const links = mailLinks(options.uiOrigin);
  return janusMail({
    mailer: options.mailer,
    from: options.from,
    brand: mailBrand,
    fallbackLocale: "en",
    clock: options.clock,
    links,
  });
}

const whenOf = (at: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at);

// The security notices: a password or a second factor changed, a recovery code
// used. A notice that fails fails no flow (janus logs it). `accounts` is read
// when an event arrives, since janus is built with this handler.
export const securityNotices =
  (mail: Mail, accounts: () => Accounts) => async (event: UserEvent) => {
    const notices = {
      "user.passwordChanged": mail.passwordChanged,
      "user.passwordReset": mail.passwordChanged,
      "user.secondFactorEnabled": mail.twoFactorEnabled,
      "user.secondFactorDisabled": mail.twoFactorDisabled,
    } as const;
    if (event.type === "user.recoveryCodeUsed") {
      const users = accounts().user;
      const user = await users.get(event.userId);
      const recoveryCodesLeft =
        await users.secondFactor.recoveryCodesLeft(user);
      if (recoveryCodesLeft === null) return;
      const locale = user.locale ?? "en";
      await mail.recoveryCodeUsed(
        { name: user.name, email: user.email, locale },
        { when: whenOf(event.occurredAt, locale), recoveryCodesLeft },
      );
      return;
    }
    if (!(event.type in notices)) return;
    // A first password is a sign-up's own (a passwordless account choosing
    // one): the account was just made, it is not a change to warn about.
    if (event.type === "user.passwordChanged" && event.first) return;
    const user = await accounts().user.get(event.userId);
    await notices[event.type as keyof typeof notices]({
      name: user.name,
      email: user.email,
      locale: user.locale ?? "en",
    });
  };
