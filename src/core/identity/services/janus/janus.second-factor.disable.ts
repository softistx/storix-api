import type { Identity } from "../../identity.port";
import { authCall, secondFactorState } from "./janus.errors";
import type { Deps } from "./janus.shared";
import { assertFresh } from "./janus.step-up";

// The code of an authenticator app: six digits. Anything else is read as a
// recovery code.
const APP_CODE = /^\d{6}$/;

// Turns the factor off on a current code of the app (a step-up of the
// request's session checks it, five attempts per challenge), or, for a lost
// phone, on a recovery code (spent: no session, no event,
// five tries per window). Either way the session must be fresh.
export async function disableSecondFactor(
  deps: Deps,
  ...[request, principal, code]: Parameters<Identity["disableSecondFactor"]>
): ReturnType<Identity["disableSecondFactor"]> {
  const users = deps.accounts.user;
  assertFresh(deps, principal);
  return authCall(async () => {
    const user = await users.get(principal.accountId);
    if (!user.hasSecondFactor) {
      throw secondFactorState();
    }
    if (APP_CODE.test(code.trim())) {
      const issued = await users.stepUp.request(user);
      if (issued.via !== "secondFactor") {
        throw secondFactorState();
      }
      await users.stepUp.confirm(request, issued.challenge, code);
    } else {
      await users.secondFactor.spendRecoveryCode(user, code);
    }
    await users.secondFactor.disable(user);
    return true as const;
  });
}
