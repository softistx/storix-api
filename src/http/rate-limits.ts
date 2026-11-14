import { bindRateLimit, defineRateLimit } from "@softistx/redis";
import type { RedisClient } from "bun";
import { GraphQLError } from "graphql";
import { rateLimited } from "../i18n/fail";

// One window of attempts: `limit` per `per` milliseconds.
export interface Window {
  limit: number;
  per: number;
}

export interface LimitsConfig {
  signUp: Window;
  signIn: Window;
  passwordReset: Window;
}

// The per-address limits of the operations anyone may call. Each takes the
// client address (`ctx.ip`) and refuses 429 `auth.errors.rate-limited` past its
// window, with the seconds to wait in `extensions.retryAfter`.
export interface Limits {
  signUp(ip: string | undefined): Promise<void>;
  signIn(ip: string | undefined): Promise<void>;
  passwordReset(ip: string | undefined): Promise<void>;
}

const unlimited: Limits = {
  signUp: async () => undefined,
  signIn: async () => undefined,
  passwordReset: async () => undefined,
};

// The limits over Redis (`@softistx/redis`, one bucket per address and
// operation). Without a client (REDIS_URL unset, development) nothing is
// limited. A Redis that cannot answer lets the request through, logged: a
// sign-in must not stop because the counter is down, and janus's per-account
// throttles still hold.
export function createLimits(
  client: RedisClient | undefined,
  config: LimitsConfig,
): Limits {
  if (!client) return unlimited;
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
      try {
        const result = await bound.consume({ ip: ip ?? "unknown" });
        if (!result.allowed) {
          throw rateLimited(Math.max(1, Math.ceil(result.retryAfter / 1000)));
        }
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        console.error(
          `storix-api: the ${name} rate limit could not be checked: ${error instanceof Error ? error.message : error}`,
        );
      }
    };
  };
  return {
    signUp: guard("sign-up", config.signUp),
    signIn: guard("sign-in", config.signIn),
    passwordReset: guard("password-reset", config.passwordReset),
  };
}
