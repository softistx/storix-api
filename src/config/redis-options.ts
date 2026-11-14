import type { RedisOptions } from "bun";

// How the one Redis client behaves when the server is away. Bun's defaults wait
// 10 s per connection attempt and retry 20 times, so a rate-limit check could
// hang a sign-in for minutes. Here an attempt gives up in a second and the
// client stops retrying after five; `createLimits` also cuts each check at
// `CHECK_TIMEOUT_MS` and lets the request through, logged. The offline queue
// stays on: with it off, Bun refuses the first commands of a lazily connecting
// client ("offline queue is disabled").
export const redisOptions: RedisOptions = {
  connectionTimeout: 1_000,
  maxRetries: 5,
};
