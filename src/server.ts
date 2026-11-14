import { app } from "./app";
import { boot } from "./config/boot";
import { connection } from "./config/db";
import { env } from "./config/env";

await boot(connection.client.db(env.MONGO_CORE_DATABASE), {
  autoMigrate: Bun.env["NODE_ENV"] !== "production",
});
app.listen({ port: env.PORT });
console.log(`storix-api listening on :${env.PORT}`);
