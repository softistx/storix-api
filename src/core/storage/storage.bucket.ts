import type { MediaBucket } from "@alxia/media";
import { bindBucket, defineBucket } from "@softistx/s3";

export interface BucketSettings {
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// The one private bucket (plan §3.4). The key a route gives is the whole object
// key: the workspace prefix is added by `keyPrefix` (storage.access.ts).
export const filesBucket = (name: string) =>
  defineBucket({ bucket: name, key: (params: { key: string }) => params.key });

// The bucket bound to its credentials.
export function openBucket(settings: BucketSettings): MediaBucket {
  return bindBucket(filesBucket(settings.bucket), {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    ...(settings.endpoint && { endpoint: settings.endpoint }),
    ...(settings.region && { region: settings.region }),
  }) as unknown as MediaBucket;
}
