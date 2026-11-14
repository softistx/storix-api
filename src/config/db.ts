import { type CoreCollectionsOf, coreCollectionsOf } from "@alxia/modules";
import { connectMongo, defineMongo, openMongo } from "@softistx/mongo";
import { modules } from "../modules/registry";
import { autoSyncOf } from "./auto-sync";
import { env } from "./env";

// ONE MongoClient for the whole process (connectMongo shares it per URI), never
// one per workspace. The core database is opened on it below, E1 adds the
// workspaces' databases; none of them closes it: `closeDatabases` does.
export const connection = await connectMongo(env.MONGO_URI, {
  appName: "storix-api",
});

// The core database: the collections the registered modules declare as
// `coreCollections` (the translations; E1 adds the workspace registry). Their
// validators and indexes are created on first use outside production, and in
// production when MONGO_AUTO_SYNC is on; otherwise `bun run db:sync` does.
export const core = await openMongo(
  defineMongo({
    client: connection.client,
    database: env.MONGO_CORE_DATABASE,
    // The registry types the slot (`Register`): the list is typed there, the
    // function reads it as plain records.
    collections: coreCollectionsOf(modules) as CoreCollectionsOf,
    autoSync: autoSyncOf(
      Bun.env["NODE_ENV"] === "production",
      env.MONGO_AUTO_SYNC,
    ),
  }),
);

// Whether MongoDB answers a ping within a second (GET /ready).
export async function mongoAnswers(): Promise<boolean> {
  try {
    const answer = await connection.client
      .db("admin")
      .command({ ping: 1 }, { timeoutMS: 1_000 });
    return answer["ok"] === 1;
  } catch {
    return false;
  }
}

// The shutdown: the shared client, last.
export async function closeDatabases() {
  await connection.close();
}
