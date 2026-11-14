import { app } from "./app";
import { identity } from "./config/auth";
import { autoSyncOf } from "./config/auto-sync";
import { boot } from "./config/boot";
import { connection } from "./config/db";
import { env } from "./config/env";

await boot(connection.client.db(env.MONGO_CORE_DATABASE), {
  autoMigrate: Bun.env["NODE_ENV"] !== "production",
  ...(autoSyncOf(Bun.env["NODE_ENV"] === "production", env.MONGO_AUTO_SYNC) && {
    identity,
  }),
});
app.listen({ port: env.PORT });
console.log(`storix-api listening on :${env.PORT}`);
