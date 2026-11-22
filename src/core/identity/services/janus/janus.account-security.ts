import { JanusError } from "@softistx/janus";
import type { Identity, Principal } from "../../identity.port";
import { PASSWORD_MIN_LENGTH } from "./janus.accounts";
import {
  authCall,
  currentPasswordWrong,
  sessionNotFound,
  tooShort,
} from "./janus.errors";
import type { Deps } from "./janus.shared";
import { assertFresh } from "./janus.step-up";

type Flows = Pick<
  Identity,
  "changePassword" | "sessions" | "revokeSession" | "revokeOtherSessions"
>;

// The password and the sessions of the signed-in account, over janus. The
// changes need a fresh session (a sign-in or a step-up in the last ten
// minutes), so a stolen session cannot lock its owner out or change the
// password; listing needs none.
export function accountSecurityFlows(deps: Deps): Flows {
  const { accounts } = deps;
  const users = accounts.user;
  const fresh = (principal: Principal) => assertFresh(deps, principal);

  // Ends the account's sessions but the request's, and how many ended.
  const endOthers = (principal: Principal) =>
    accounts.signOutEverywhere(
      { id: principal.accountId },
      principal.sessionId === null ? {} : { except: principal.sessionId },
    );

  return {
    changePassword: async (principal, { current, next }) => {
      fresh(principal);
      if (next.length < PASSWORD_MIN_LENGTH) {
        throw tooShort(PASSWORD_MIN_LENGTH, "next");
      }
      await authCall(async () => {
        try {
          await users.changePassword(principal.accountId, { current, next });
        } catch (error) {
          // A wrong current password; the throttled one stays a 429 (authCall).
          if (
            error instanceof JanusError &&
            error.code === "CREDENTIALS_INVALID" &&
            error.retryAfter === undefined
          ) {
            throw currentPasswordWrong();
          }
          throw error;
        }
      });
      // The password is changed: whoever held the old one loses their
      // sessions. A failure here is logged, never answered as a failed change.
      try {
        await endOthers(principal);
      } catch (error) {
        console.error(
          `storix-api: the sign-out after a password change failed: ${error instanceof Error ? error.message : error}`,
        );
      }
      return true as const;
    },

    sessions: (principal) =>
      authCall(async () =>
        (await accounts.sessions.list({ id: principal.accountId })).map(
          (session) => ({
            id: session.id,
            device: session.device ?? null,
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt ?? null,
            expiresAt: session.expiresAt,
            current: session.id === principal.sessionId,
          }),
        ),
      ),

    revokeSession: async (principal, sessionId) => {
      fresh(principal);
      const revoked = await authCall(() =>
        accounts.sessions.revoke({ id: principal.accountId }, sessionId),
      );
      if (!revoked) throw sessionNotFound();
      return true as const;
    },

    revokeOtherSessions: async (principal) => {
      fresh(principal);
      return authCall(() => endOthers(principal));
    },
  };
}
