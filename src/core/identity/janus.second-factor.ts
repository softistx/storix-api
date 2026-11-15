import { fail } from "@/i18n/fail";
import type { Identity, Principal } from "./identity.port";
import { authCall } from "./janus.errors";
import type { Deps } from "./janus.shared";
import { assertFresh } from "./janus.step-up";

type Flows = Pick<
  Identity,
  | "enrolSecondFactor"
  | "activateSecondFactor"
  | "regenerateRecoveryCodes"
  | "disableSecondFactor"
  | "secondFactorStatus"
>;

// The code of an authenticator app: six digits. Anything else is read as a
// recovery code.
const APP_CODE = /^\d{6}$/;

// The TOTP second factor (an authenticator app, with ten recovery codes), over
// janus. janus counts the tries and the replays; this adds the application's
// policy: enrolling, activating, regenerating and disabling need a fresh
// session, and enrolling an e-mail the account proved.
export function secondFactorFlows(deps: Deps): Flows {
  const { accounts } = deps;
  const users = accounts.user;
  const fresh = (principal: Principal) => assertFresh(deps, principal);

  const verified = (principal: Principal) => {
    if (!principal.emailVerified) {
      throw fail("identity.errors.email-unverified", { status: 403 });
    }
  };

  return {
    // Starts the factor: `secret` and `uri` for the authenticator app.
    enrolSecondFactor: async (principal) => {
      verified(principal);
      fresh(principal);
      return authCall(async () =>
        users.secondFactor.enroll(await users.get(principal.accountId)),
      );
    },

    // The first code of the app: the factor is active, and its ten recovery
    // codes are answered, this once. Every OTHER session of the account ends
    // (a password-only session opened before would otherwise pass a second
    // factor policy); a failure there is logged, never allowed to lose codes
    // that exist only in this answer.
    activateSecondFactor: async (principal, code) => {
      fresh(principal);
      return authCall(async () => {
        const { recoveryCodes } = await users.secondFactor.activate(
          principal.accountId,
          code,
        );
        try {
          await accounts.signOutEverywhere(
            { id: principal.accountId },
            principal.sessionId === null ? {} : { except: principal.sessionId },
          );
        } catch (error) {
          console.error(
            `storix-api: the sign-out after activating a second factor failed: ${error instanceof Error ? error.message : error}`,
          );
        }
        return { recoveryCodes: [...recoveryCodes] };
      });
    },

    // Ten new recovery codes on a current code of the app; the old ones end.
    regenerateRecoveryCodes: async (principal, code) => {
      fresh(principal);
      return authCall(async () => {
        const { recoveryCodes } =
          await users.secondFactor.regenerateRecoveryCodes(
            principal.accountId,
            code,
          );
        return { recoveryCodes: [...recoveryCodes] };
      });
    },

    // Turns the factor off on a current code of the app (a step-up of the
    // request's session checks it, five attempts per challenge), or, for a lost
    // phone, on a recovery code (spent: no session, no event,
    // five tries per window). Either way the session must be fresh.
    disableSecondFactor: async (request, principal, code) => {
      fresh(principal);
      return authCall(async () => {
        const user = await users.get(principal.accountId);
        if (!user.hasSecondFactor) {
          throw fail("identity.errors.second-factor-state", { status: 409 });
        }
        if (APP_CODE.test(code.trim())) {
          const issued = await users.stepUp.request(user);
          if (issued.via !== "secondFactor") {
            throw fail("identity.errors.second-factor-state", { status: 409 });
          }
          await users.stepUp.confirm(request, issued.challenge, code);
        } else {
          await users.secondFactor.spendRecoveryCode(user, code);
        }
        await users.secondFactor.disable(user);
        return true as const;
      });
    },

    secondFactorStatus: async (principal) => {
      if (!principal.secondFactor) {
        return { enabled: false, recoveryCodesLeft: null };
      }
      return authCall(async () => {
        const user = await users.get(principal.accountId);
        return {
          enabled: user.hasSecondFactor,
          recoveryCodesLeft: await users.secondFactor.recoveryCodesLeft(user),
        };
      });
    },
  };
}
