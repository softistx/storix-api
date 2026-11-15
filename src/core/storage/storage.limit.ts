import { bindRateLimit, defineRateLimit } from "@softistx/redis";
import type { RedisClient } from "bun";

export interface UploadWindow {
  limit: number;
  per: number;
  burst: number;
}

// Uploads allowed per account and workspace (plan §3.5): 30 a minute with a
// burst of 60.
export const defaultUploadWindow: UploadWindow = {
  limit: 30,
  per: 60_000,
  burst: 60,
};

// Seconds to wait when refused, 0 when the upload may go on.
export type UploadLimit = (key: string) => Promise<number>;

const CHECK_TIMEOUT_MS = 750;

// Over Redis, and closed: a Redis that does not answer refuses the upload
// (plan §3.5, unlike the sign-in limits). Without a client (development) no
// upload is limited.
export function createUploadLimit(
  client: RedisClient | undefined,
  window: UploadWindow = defaultUploadWindow,
): UploadLimit {
  if (!client) return async () => 0;
  const bound = bindRateLimit(
    client,
    defineRateLimit({
      name: "storix.upload",
      key: (params: { key: string }) => params.key,
      ...window,
    }),
  );
  return async (key) => {
    try {
      const result = await bound.consume({ key }, 1, {
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      return result.allowed
        ? 0
        : Math.max(1, Math.ceil(result.retryAfter / 1000));
    } catch (error) {
      console.error(
        `storix-api: the upload rate limit could not be checked: ${error instanceof Error ? error.message : error}`,
      );
      return 5;
    }
  };
}
