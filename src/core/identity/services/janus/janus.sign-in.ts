import type { Identity } from "../../identity.port";
import { authCall, signInCall } from "./janus.errors";
import { type Deps, mailLocaleOf, resultOf } from "./janus.shared";

type Flows = Pick<
  Identity,
  | "signIn"
  | "confirmSecondFactor"
  | "recoverSecondFactor"
  | "signOut"
  | "requestPasswordReset"
  | "resetPassword"
>;

// The sign-in, sign-out and reset flows, over janus.
export function signInFlows(deps: Deps): Flows {
  const { accounts, mail, background } = deps;
  const users = accounts.user;

  return {
    signIn: (input, options = {}) =>
      signInCall(async () => resultOf(await users.signIn(input, options))),

    // The code of the authenticator app, for the challenge a sign-in answered.
    confirmSecondFactor: (challenge, code, options = {}) =>
      signInCall(async () =>
        resultOf(await users.secondFactor.confirm(challenge, code, options)),
      ),

    // A recovery code instead of the app's, for a lost phone.
    recoverSecondFactor: (challenge, recoveryCode, options = {}) =>
      signInCall(async () =>
        resultOf(
          await users.secondFactor.recover(challenge, recoveryCode, options),
        ),
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
