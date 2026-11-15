import { openBucket } from "../core/storage";
import { env } from "./env";

// The files' bucket, bound when S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are
// set; without them /media answers 503 `storage.errors.unavailable`. Its own
// file so that a script can take the bucket without the Redis connection.
export const bucket =
  env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
    ? openBucket({
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
      })
    : undefined;
