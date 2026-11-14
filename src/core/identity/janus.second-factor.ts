import { assertFresh as janusAssertFresh } from "@softistx/janus";
import { fail } from "@/i18n/fail";
import type { Identity, Principal } from "./identity.port";
import { authCall, stepUpRequired } from "./janus.errors";
import { type Deps, mailLocaleOf } from "./janus.shared";

// How long a sign-in or a step-up keeps a session "fresh" for the sensitive
// operations.
export const FRESH_FOR_MS = 10 * 60 * 1000;

type Flows = Pick<
  Identity,
  | "assertFresh"
  | "requestStepUp"
  | "confirmStepUp"
  | "enrolSecondFactor"
  | "activateSecondFactor"
  | "regenerateRecoveryCodes"
  | "disableSecondFactor"
  | "secondFactorStatus"
>;

// The step-up of a session and the TOTP second factor (an authenticator app,
// with ten recovery codes), over janus. janus counts the tries and the
// replays; this adds the application's policy: enrolling, activating,
// regenerating and disabling need a fresh session, and enrolling an e-mail
// the account proved.
export function secondFactorFlows(deps: Deps): Flows {
  const { accounts, mail, background, clock } = deps;
  const users = accounts.user;

  // Refuses a principal whose session proved who it is `maxAgeMs` ago or more.
  // A key has no session: it is never fresh.
  function assertFresh(principal: Principal, maxAgeMs = FRESH_FOR_MS) {
    if (principal.authenticatedAt === null) throw stepUpRequired();
    try {
      janusAssertFresh(
        {
          authenticatedAt: principal.authenticatedAt,
          userId: principal.accountId,
        },
        maxAgeMs,
        clock,
      );
    } catch (error) {
      void error;
      throw stepUpRequired();
    }
  }

  const verified = (principal: Principal) => {
    if (!principal.emailVerified) {
      throw fail("identity.errors.email-unverified", { status: 403 });
    }
  };

  return {
    assertFresh,

    // Issues the challenge: a code of the app for an account with an active
    // second factor, else a code mailed to its current address (sent in the
    // background; janus's mail throttle answers in the request).
    requestStepUp: (request, principal) =>
      authCall(async () => {
        const issued = await users.stepUp.request(principal.accountId);
        if (issued.via === "secondFactor") {
          return {
            method: "AUTHENTICATOR" as const,
            challenge: issued.challenge,
            expiresAt: issued.expiresAt,
          };
        }
        const locale = issued.user.locale ?? mailLocaleOf(request);
        background.run("a step-up code", async () => {
          await mail.stepUp(issued, { name: issued.user.name, locale });
        });
        return {
          method: "EMAIL" as const,
          challenge: issued.challenge,
          expiresAt: issued.expiresAt,
        };
      }),

    // Checks the code and marks the request's session as confirmed.
    confirmStepUp: (request, _principal, challenge, code) =>
      authCall(async () => {
        const session = await users.stepUp.confirm(request, challenge, code);
        return new Date(session.authenticatedAt.getTime() + FRESH_FOR_MS);
      }),

    // Starts the factor: `secret` and `uri` for the authenticator app.
    enrolSecondFactor: async (principal) => {
      verified(principal);
      assertFresh(principal);
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
      assertFresh(principal);
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
      assertFresh(principal);
      return authCall(async () => {
        const { recoveryCodes } =
          await users.secondFactor.regenerateRecoveryCodes(
            principal.accountId,
            code,
          );
        return { recoveryCodes: [...recoveryCodes] };
      });
    },

    // Turns the factor off on a current code of the app, which a step-up of
    // the request's session checks (five attempts per challenge).
    disableSecondFactor: async (request, principal, code) => {
      assertFresh(principal);
      return authCall(async () => {
        const user = await users.get(principal.accountId);
        const issued = user.hasSecondFactor
          ? await users.stepUp.request(user)
          : null;
        if (issued?.via !== "secondFactor")
          throw fail("identity.errors.second-factor-state", { status: 409 });
        await users.stepUp.confirm(request, issued.challenge, code);
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
