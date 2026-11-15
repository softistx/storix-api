import { type Duration, defineRedis, openRedis } from "@softistx/redis";
import { RedisClient } from "bun";
import { createLimits } from "../http/rate-limits";
import * as queueDefinitions from "../queues";
import { env } from "./env";
import { redisOptions } from "./redis-options";

// The one Redis connection (REDIS_URL; none when it is unset, outside
// production) and what counts on it: the per-address limits.
export const redis = env.REDIS_URL
  ? new RedisClient(env.REDIS_URL, redisOptions)
  : undefined;

// The queues over that same client (plan §3.14): `addFile` adds to them and the
// worker (src/worker.ts) runs them. None without REDIS_URL. `openRedis` is
// handed the client unconnected, like the limits' use of it; closing it leaves
// the client to its owner (`closeQueues` closes both).
export const appRedis = redis
  ? await openRedis(
      defineRedis({
        client: redis,
        prefix: "storix",
        queues: queueDefinitions,
      }),
    )
  : undefined;

export type AppRedis = NonNullable<typeof appRedis>;

// Stops the queue workers (the running jobs get `grace` to finish), then
// closes the connection.
export async function closeQueues(options?: { grace?: Duration }) {
  await appRedis?.close(options);
  redis?.close();
}

export const limits = createLimits(redis, {
  signUp: env.RATE_LIMIT_SIGN_UP,
  signIn: env.RATE_LIMIT_SIGN_IN,
  passwordReset: env.RATE_LIMIT_PASSWORD_RESET,
  workspaceCreate: env.RATE_LIMIT_WORKSPACE_CREATE,
  invitationSend: env.RATE_LIMIT_INVITATION_SEND,
  invitationCode: env.RATE_LIMIT_INVITATION_CODE,
});
