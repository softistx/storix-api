import { health } from "@alxia/core";
import { graphql, type ServerContext } from "@alxia/graphql";
import type { MediaBucket } from "@alxia/media";
import { identity as serverIdentity } from "./config/auth";
import { closeDatabases, mongoAnswers } from "./config/db";
import { appRedis, closeQueues, limits as serverLimits } from "./config/redis";
import {
  bucket as serverBucket,
  uploadLimit as serverUploadLimit,
} from "./config/storage";
import {
  auditor as serverAuditor,
  members as serverMembers,
} from "./config/wiring";
import type { Auditor } from "./core/audit";
import type { Identity } from "./core/identity";
import type { MemberWiring } from "./core/members";
import {
  type FileReader,
  storageRoutes,
  type UploadLimit,
} from "./core/storage";
import type { Translations } from "./core/translations/translations.load";
import { type Base, createBase } from "./http/context";
import { clientHeader } from "./http/csrf";
import { graphqlPlugins } from "./http/graphql-plugins";
import { keyPathsOnly } from "./http/key-paths";
import type { Limits } from "./http/rate-limits";
import { schema } from "./http/schema";
import { fileReader, type RenditionsQueue } from "./modules/files/public";

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
    // `fileReader` decides who may read a `files` key (default: the `files`
    // module's, a node of the caller's tree holds it).
    media?: {
      bucket: MediaBucket | undefined;
      limit?: UploadLimit;
      fileReader?: FileReader;
    };
    // The `renditions` queue `addFile` adds to (`undefined`: a file has no
    // previews and is `READY` at once); specs inject one over their own Redis.
    renditions?: RenditionsQueue | undefined;
    // What the app hands down to the kernel (src/config/wiring.ts): the member
    // listeners and the audit port, which specs may replace, and the
    // translations `boot` loaded (without them `errorCatalogue` fails).
    members?: MemberWiring;
    audit?: Auditor;
    translations?: Translations;
  } = {},
) {
  const bucket = options.media ? options.media.bucket : serverBucket;
  const renditions =
    "renditions" in options ? options.renditions : appRedis?.queues.renditions;
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
          context: (_: { serverContext: ServerContext<Base["~context"]> }) => ({
            media: bucket,
            renditions,
            members: options.members ?? serverMembers,
            audit: options.audit ?? serverAuditor,
            translations: options.translations,
          }),
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
          fileReader: options.media?.fileReader ?? fileReader,
        }),
      )
      .onStop(async () => {
        await closeDatabases();
        await closeQueues();
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

export type App = ReturnType<typeof createApp>;
