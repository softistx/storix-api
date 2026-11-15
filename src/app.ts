import { health } from "@alxia/core";
import { graphql } from "@alxia/graphql";
import type { MediaBucket } from "@alxia/media";
import { identity as serverIdentity } from "./config/auth";
import { closeDatabases, mongoAnswers } from "./config/db";
import { redis, limits as serverLimits } from "./config/redis";
import {
  bucket as serverBucket,
  uploadLimit as serverUploadLimit,
} from "./config/storage";
import type { Identity } from "./core/identity";
import { storageRoutes, type UploadLimit } from "./core/storage";
import { createBase } from "./http/context";
import { clientHeader } from "./http/csrf";
import { graphqlPlugins } from "./http/graphql-plugins";
import { keyPathsOnly } from "./http/key-paths";
import type { Limits } from "./http/rate-limits";
import { schema } from "./http/schema";

// The largest body /graphql reads.
export const BODY_LIMIT = 100 * 1024;

// The probes (GET /health, GET /ready), POST and GET /graphql, and /media
// (src/core/storage), behind the base's middlewares. /graphql refuses a request
// without `x-storix-client` (src/http/csrf.ts), which Apollo Sandbox is given.
// /ready answers 503 while MongoDB does not (a ping).
export function createApp(
  options: {
    schema?: typeof schema;
    // Whether MongoDB answers (GET /ready); injected by specs.
    mongo?: () => Promise<boolean>;
    // The identity the app runs; specs inject one over an in-memory mailer.
    identity?: Identity;
    // The per-address limits; specs inject ones over their own Redis.
    limits?: Limits;
    // The files' bucket (`undefined`: /media answers 503) and the upload
    // limit; specs inject ones over their own SeaweedFS and Redis.
    media?: { bucket: MediaBucket | undefined; limit?: UploadLimit };
  } = {},
) {
  const bucket = options.media ? options.media.bucket : serverBucket;
  return (
    createBase(
      options.identity ?? serverIdentity,
      options.limits ?? serverLimits,
    )
      .use(keyPathsOnly)
      .plugin(probes(options.mongo ?? mongoAnswers))
      // A body past 100 KiB is refused (413) before it is read: a query is a few
      // kilobytes (alxia's production guide, "Cap the body").
      .bodyLimit(BODY_LIMIT)
      .plugin((app) =>
        graphql(app, {
          schema: options.schema ?? schema,
          context: () => ({ media: bucket }),
          plugins: graphqlPlugins,
          ide: "apollo-sandbox",
          sandbox: { initialHeaders: { [clientHeader]: "apollo-sandbox" } },
        }),
      )
      // /media after the auth middleware: the kinds read the viewer and the
      // guard it adds, and every object lives under the workspace's prefix.
      .plugin(
        storageRoutes({
          bucket,
          limit: options.media?.limit ?? serverUploadLimit,
        }),
      )
      .onStop(async () => {
        await closeDatabases();
        redis?.close();
      })
  );
}

// /health and /ready: Mongo answers a ping within a second.
function probes(mongo: () => Promise<boolean>) {
  return health({
    checks: {
      mongo,
    },
  });
}

// The app the server runs.
export const app = createApp();

export type App = typeof app;
