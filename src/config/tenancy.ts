import { collectionsOf } from "@alxia/modules";
import { perOrganization } from "@alxia/tenancy";
import { defineMongo } from "@softistx/mongo";
import type { TenancyPort } from "../core/access";
import { membershipOf } from "../core/members";
import { workspaceRegistry } from "../core/workspaces";
import { modules } from "../modules/registry";
import { autoSyncOf } from "./auto-sync";
import { connection, core } from "./db";
import { env } from "./env";

// The header that names the request's workspace, by id or slug.
export const WORKSPACE_HEADER = "x-storix-workspace";

// The tenancy of the API: the registry of workspaces and the memberships in the
// core database, one database per workspace (`<MONGO_WORKSPACE_PREFIX><id>`)
// opened on the shared client and kept in a bounded cache. A request's scope
// is its workspace's database; a resolver never builds a database name.
export const store = perOrganization({
  core,
  modules,
  registry: workspaceRegistry(core),
  membership: membershipOf(core),
  header: WORKSPACE_HEADER,
  database: env.MONGO_WORKSPACE_PREFIX,
  size: env.MONGO_WORKSPACE_CACHE_SIZE,
  configure: (database) =>
    defineMongo({
      client: connection.client,
      database,
      collections: collectionsOf(modules),
      autoSync: autoSyncOf(
        Bun.env["NODE_ENV"] === "production",
        env.MONGO_AUTO_SYNC,
      ),
    }),
});

// The same store, as the plain port the request context carries
// (src/core/access/ports.ts explains why it is not `typeof store`).
export const tenancy: TenancyPort = store as unknown as TenancyPort;

export type Tenancy = typeof store;
