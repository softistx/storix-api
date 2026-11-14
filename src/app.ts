import { health } from "@alxia/core";
import { graphql } from "@alxia/graphql";
import { identity as serverIdentity } from "./config/auth";
import { closeDatabases, mongoAnswers } from "./config/db";
import type { Identity } from "./core/identity";
import { createBase } from "./http/context";
import { clientHeader } from "./http/csrf";
import { graphqlPlugins } from "./http/graphql-plugins";
import { keyPathsOnly } from "./http/key-paths";
import { schema } from "./http/schema";

// The largest body /graphql reads.
export const BODY_LIMIT = 100 * 1024;

// The probes (GET /health, GET /ready), then POST and GET /graphql, the one
// entry point, behind the base's middlewares. /graphql refuses a request
// without `x-storix-client` (src/http/csrf.ts), which Apollo Sandbox is given.
// /ready answers 503 while MongoDB does not (a ping).
export function createApp(
  options: {
    schema?: typeof schema;
    // Whether MongoDB answers (GET /ready); injected by specs.
    mongo?: () => Promise<boolean>;
    // The identity the app runs; specs inject one over an in-memory mailer.
    identity?: Identity;
  } = {},
) {
  return (
    createBase(options.identity ?? serverIdentity)
      .use(keyPathsOnly)
      .plugin(probes(options.mongo ?? mongoAnswers))
      // A body past 100 KiB is refused (413) before it is read: a query is a few
      // kilobytes (alxia's production guide, "Cap the body").
      .bodyLimit(BODY_LIMIT)
      .plugin((app) =>
        graphql(app, {
          schema: options.schema ?? schema,
          context: () => ({}),
          plugins: graphqlPlugins,
          ide: "apollo-sandbox",
          sandbox: { initialHeaders: { [clientHeader]: "apollo-sandbox" } },
        }),
      )
      .onStop(async () => {
        await closeDatabases();
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
