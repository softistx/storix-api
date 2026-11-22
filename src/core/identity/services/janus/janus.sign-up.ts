import { JanusError } from "@softistx/janus";
import type { Identity, SignInResult } from "../../identity.port";
import { PASSWORD_MIN_LENGTH } from "./janus.accounts";
import { authCall, signInCall, tooShort } from "./janus.errors";
import { type Deps, resultOf, verificationSent } from "./janus.shared";
import { signUpFollowUp } from "./janus.sign-up.follow-up";

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
          signUpFollowUp(deps, input.email, false);
          return verificationSent;
        } catch (error) {
          if (error instanceof JanusError && error.code === "LOGIN_TAKEN") {
            signUpFollowUp(deps, input.email, true);
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
    completeSignUp: (token, password, options = {}): Promise<SignInResult> =>
      signInCall(async () => {
        if (password.length < PASSWORD_MIN_LENGTH) {
          throw tooShort(PASSWORD_MIN_LENGTH);
        }
        const user = await users.verifyEmail.confirm(token, {
          firstProof: true,
        });
        await users.setPassword(user, password);
        return resultOf(await users.signInProven(user, options));
      }),
  };
}
