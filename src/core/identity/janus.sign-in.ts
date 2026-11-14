import { JanusError } from "@softistx/janus";
import type {
  Identity,
  Locale,
  Principal,
  SignInResult,
} from "./identity.port";
import { PASSWORD_MIN_LENGTH } from "./janus.accounts";
import { authCall, signInCall, tooShort } from "./janus.errors";
import {
  type Deps,
  localeOf,
  mailLocaleOf,
  resultOf,
  verificationSent,
} from "./janus.shared";

type Flows = Pick<
  Identity,
  | "signUp"
  | "completeSignUp"
  | "resendVerificationEmail"
  | "signIn"
  | "confirmSecondFactor"
  | "recoverSecondFactor"
  | "signOut"
  | "requestPasswordReset"
  | "resetPassword"
>;

// The sign-up, sign-in, sign-out and reset flows, over janus.
//
// Sign-up opens an account with NO password and NO session; its owner chooses
// a password only by following the verification link (`completeSignUp`). No
// credential exists before the address is proved, so whoever registers an
// address they do not own gains nothing. An address that is taken answers the
// very same result and creates nothing (its owner is mailed a notice), so no
// answer tells whether an address is taken.
export function signInFlows(deps: Deps): Flows {
  const { accounts, mail, background } = deps;
  const users = accounts.user;

  // What follows the insert, in the background, the same for both answers so
  // that neither the result nor its time tells whether the address was taken.
  // A taken address is sent a fresh verification link when its account is not
  // proved yet, else the "someone tried to sign up with your address" notice.
  function followUp(email: string, locale: Locale, taken: boolean) {
    background.run("a sign-up follow-up", async () => {
      try {
        // Spends the per-address mail count either way, as a reset does.
        await users.resetPassword.prepare(email);
        if (!taken) return;
        const owner = await users.findByEmail(email);
        if (!owner) return;
        if (!owner.emailVerified) {
          const issued = await users.verifyEmail.send(owner);
          await mail.verifyEmail(issued, { name: owner.name, locale });
          return;
        }
        await mail.signUpAttempted({
          name: owner.name,
          email: owner.email,
          locale: localeOf(owner),
        });
      } catch (error) {
        if (error instanceof JanusError) return;
        throw error;
      }
    });
  }

  return {
    signUp: (input) =>
      authCall(async () => {
        try {
          const user = await users.create({
            email: input.email,
            name: input.name,
            locale: input.locale,
          });
          background.run("a verification mail", async () => {
            const issued = await users.verifyEmail.send(user);
            await mail.verifyEmail(issued, {
              name: user.name,
              locale: input.locale,
            });
          });
          followUp(input.email, input.locale, false);
          return verificationSent;
        } catch (error) {
          if (error instanceof JanusError && error.code === "LOGIN_TAKEN") {
            followUp(input.email, input.locale, true);
            return verificationSent;
          }
          throw error;
        }
      }),

    // The token of the verification mail and the password the visitor chose,
    // posted together by the page its link opens (never on GET: mail scanners
    // follow links). The password is checked BEFORE the token is spent, so a
    // short password costs the visitor nothing; then the token proves the
    // address, the password is set and the session opens (or asks for the
    // second factor of an account that has one).
    completeSignUp: (token, password): Promise<SignInResult> =>
      signInCall(async () => {
        if (password.length < PASSWORD_MIN_LENGTH) {
          throw tooShort(PASSWORD_MIN_LENGTH);
        }
        const user = await users.verifyEmail.confirm(token, {
          firstProof: true,
        });
        await users.setPassword(user, password);
        return resultOf(await users.signInProven(user));
      }),

    resendVerificationEmail: (principal: Principal) =>
      authCall(async () => {
        if (principal.emailVerified) return true;
        const user = await users.get(principal.accountId);
        const issued = await users.verifyEmail.send(user);
        background.run("a verification mail", () =>
          mail.verifyEmail(issued, { name: user.name, locale: localeOf(user) }),
        );
        return true;
      }),

    signIn: (input) =>
      signInCall(async () => resultOf(await users.signIn(input))),

    // The code of the authenticator app, for the challenge a sign-in answered.
    confirmSecondFactor: (challenge, code) =>
      signInCall(async () =>
        resultOf(await users.secondFactor.confirm(challenge, code)),
      ),

    // A recovery code instead of the app's, for a lost phone.
    recoverSecondFactor: (challenge, recoveryCode) =>
      signInCall(async () =>
        resultOf(await users.secondFactor.recover(challenge, recoveryCode)),
      ),

    signOut: (request) => authCall(() => accounts.signOut(request)),

    // Sends a reset link; true either way. The address is counted in the
    // request (`prepare`), so the mail throttle answers 429 for a known and an
    // unknown address alike; the lookup and the mail run in the background.
    requestPasswordReset: async (request, email) => {
      const locale = mailLocaleOf(request);
      const prepared = await authCall(() => users.resetPassword.prepare(email));
      background.run("a password-reset link", async () => {
        const issued = await prepared.send();
        if (issued) {
          await mail.resetPassword(issued, { name: issued.user.name, locale });
        }
      });
      return true as const;
    },

    // janus signs the account out everywhere: the visitor signs in again.
    resetPassword: (token, password) =>
      authCall(async () => {
        await users.resetPassword.confirm(token, password);
        return true as const;
      }),
  };
}
