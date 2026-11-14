import { JanusError } from "@softistx/janus";
import type { Identity, SignInResult } from "./identity.port";
import { PASSWORD_MIN_LENGTH } from "./janus.accounts";
import { authCall, signInCall, tooShort } from "./janus.errors";
import {
  type Deps,
  localeOf,
  resultOf,
  verificationSent,
} from "./janus.shared";

type Flows = Pick<Identity, "signUp" | "completeSignUp">;

// The sign-up flows, over janus.
//
// Sign-up opens an account with NO password and NO session; its owner chooses
// a password only by following the verification link (`completeSignUp`). No
// credential exists before the address is proved, so whoever registers an
// address they do not own gains nothing. An address that is taken answers the
// very same result and creates nothing (its owner is mailed a notice), so no
// answer tells whether an address is taken.
export function signUpFlows(deps: Deps): Flows {
  const { accounts, mail, background } = deps;
  const users = accounts.user;

  // What follows the insert, in the background, the same for both answers so
  // that neither the result nor its time tells whether the address was taken.
  // A taken address is sent a fresh verification link when its account is not
  // proved yet (in the language of its account), else the "someone tried to sign up with your address" notice.
  function followUp(email: string, taken: boolean) {
    background.run("a sign-up follow-up", async () => {
      try {
        // Spends the per-address mail count either way, as a reset does.
        await users.resetPassword.prepare(email);
        if (!taken) return;
        const owner = await users.findByEmail(email);
        if (!owner) return;
        if (!owner.emailVerified) {
          const issued = await users.verifyEmail.send(owner);
          await mail.verifyEmail(issued, {
            name: owner.email,
            locale: localeOf(owner),
          });
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
              name: user.email,
              locale: input.locale,
            });
          });
          followUp(input.email, false);
          return verificationSent;
        } catch (error) {
          if (error instanceof JanusError && error.code === "LOGIN_TAKEN") {
            followUp(input.email, true);
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
  };
}
