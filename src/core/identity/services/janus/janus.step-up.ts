import { assertFresh as janusAssertFresh } from "@softistx/janus";
import {
  FRESH_FOR_MS,
  type Identity,
  type Principal,
} from "../../identity.port";
import { authCall, stepUpRequired } from "./janus.errors";
import { type Deps, mailLocaleOf } from "./janus.shared";

// Refuses (403 `auth.errors.step-up-required`) a principal whose session proved
// who it is `maxAgeMs` ago or more. A key has no session: it is never fresh.
export function assertFresh(
  deps: Pick<Deps, "clock">,
  principal: Principal,
  maxAgeMs = FRESH_FOR_MS,
) {
  if (principal.authenticatedAt === null) throw stepUpRequired();
  try {
    janusAssertFresh(
      {
        authenticatedAt: principal.authenticatedAt,
        userId: principal.accountId,
      },
      maxAgeMs,
      deps.clock,
    );
  } catch (error) {
    void error;
    throw stepUpRequired();
  }
}

type Flows = Pick<Identity, "assertFresh" | "requestStepUp" | "confirmStepUp">;

// The step-up of a session: a code to prove, again, who is there.
export function stepUpFlows(deps: Deps): Flows {
  const { accounts, mail, background } = deps;
  const users = accounts.user;

  return {
    assertFresh: (principal, maxAgeMs) =>
      assertFresh(deps, principal, maxAgeMs),

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
  };
}
