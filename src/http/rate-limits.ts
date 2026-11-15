import { bindRateLimit, defineRateLimit } from "@softistx/redis";
import type { RedisClient } from "bun";
import { GraphQLError } from "graphql";
import { rateLimited } from "../i18n/fail";

// The longest a check may take before the request goes through unchecked.
export const CHECK_TIMEOUT_MS = 750;

// One window of attempts: `limit` per `per` milliseconds.
export interface Window {
  limit: number;
  per: number;
}

export interface LimitsConfig {
  signUp: Window;
  signIn: Window;
  passwordReset: Window;
  workspaceCreate: Window;
  invitationSend: Window;
  invitationCode: Window;
}

// The per-address limits of the operations anyone may call. Each takes the
// client address (`ctx.ip`) and refuses 429 `auth.errors.rate-limited` past its
// window, with the seconds to wait in `extensions.retryAfter`.
export interface Limits {
  signUp(ip: string | undefined): Promise<void>;
  signIn(ip: string | undefined): Promise<void>;
  passwordReset(ip: string | undefined): Promise<void>;
  workspaceCreate(ip: string | undefined): Promise<void>;
  // Per inviter (an account id): the invitations a person sends, each a mail.
  invitationSend(inviter: string | undefined): Promise<void>;
  // Per client address: the previews and accepts of an invitation code, open
  // to whoever holds one.
  invitationCode(ip: string | undefined): Promise<void>;
}

const unlimited: Limits = {
  signUp: async () => undefined,
  signIn: async () => undefined,
  passwordReset: async () => undefined,
  workspaceCreate: async () => undefined,
  invitationSend: async () => undefined,
  invitationCode: async () => undefined,
};

// The limits over Redis (`@softistx/redis`, one bucket per address and
// operation). Without a client (REDIS_URL unset, development) nothing is
// limited. A Redis that cannot answer lets the request through, logged: a
// sign-in must not stop because the counter is down, and janus's per-account
// throttles still hold. A Redis that answers slowly is cut at
// `CHECK_TIMEOUT_MS`; a request with no address is not limited (logged once).
export function createLimits(
  client: RedisClient | undefined,
  config: LimitsConfig,
): Limits {
  if (!client) return unlimited;
  let noAddressLogged = false;
  const guard = (name: string, window: Window) => {
    const bound = bindRateLimit(
      client,
      defineRateLimit({
        name: `storix.${name}`,
        key: (params: { ip: string }) => params.ip,
        ...window,
      }),
    );
    return async (ip: string | undefined) => {
      if (!ip) {
        if (!noAddressLogged) {
          noAddressLogged = true;
          console.error(
            "storix-api: a request without a client address is not rate limited",
          );
        }
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          bound.consume({ ip }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`no answer in ${CHECK_TIMEOUT_MS} ms`)),
              CHECK_TIMEOUT_MS,
            );
          }),
        ]);
        if (!result.allowed) {
          throw rateLimited(Math.max(1, Math.ceil(result.retryAfter / 1000)));
        }
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        console.error(
          `storix-api: the ${name} rate limit could not be checked: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        clearTimeout(timer);
      }
    };
  };
  return {
    signUp: guard("sign-up", config.signUp),
    signIn: guard("sign-in", config.signIn),
    passwordReset: guard("password-reset", config.passwordReset),
    workspaceCreate: guard("workspace-create", config.workspaceCreate),
    invitationSend: guard("invitation-send", config.invitationSend),
    invitationCode: guard("invitation-code", config.invitationCode),
  };
}
