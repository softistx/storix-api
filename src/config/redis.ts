import { RedisClient } from "bun";
import { createLimits } from "../http/rate-limits";
import { env } from "./env";
import { redisOptions } from "./redis-options";

// The one Redis connection (REDIS_URL; none when it is unset, outside
// production) and what counts on it: the per-address limits.
export const redis = env.REDIS_URL
  ? new RedisClient(env.REDIS_URL, redisOptions)
  : undefined;

export const limits = createLimits(redis, {
  signUp: env.RATE_LIMIT_SIGN_UP,
  signIn: env.RATE_LIMIT_SIGN_IN,
  passwordReset: env.RATE_LIMIT_PASSWORD_RESET,
  workspaceCreate: env.RATE_LIMIT_WORKSPACE_CREATE,
  invitationSend: env.RATE_LIMIT_INVITATION_SEND,
  invitationCode: env.RATE_LIMIT_INVITATION_CODE,
});
