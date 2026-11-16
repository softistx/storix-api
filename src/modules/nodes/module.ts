import { defineModule } from "@alxia/modules";
import { onMemberJoined } from "@/core/members";
import { nodes as codes } from "@/i18n/codes";
import { nodesListingCollation } from "./migrations/2026-11-15-nodes-listing-collation.migration";
import { nodes } from "./nodes.collection";
import typeDefs from "./nodes.graphqls" with { type: "text" };
import { nodesMongo } from "./nodes.handle";
import { nodesResolvers } from "./nodes.resolver";
import { ensureRoot } from "./nodes.service";

// The tree of a workspace's folders, in its own database. Owns `nodes:read` and
// `nodes:manage`, which every role holds: each member has a private root, and an
// admin does not browse another member's files (plan §3.6). A member gets their
// root ("My files") when they join (`onMemberJoined`).
export const nodesModule = defineModule({
  name: "nodes",
  dependsOn: ["members", "workspaces", "audit"],
  collections: { nodes },
  migrations: [nodesListingCollation],
  codes,
  permissions: ["nodes:read", "nodes:manage"],
  defaultGrants: {
    ADMIN: ["nodes:read", "nodes:manage"],
    MEMBER: ["nodes:read", "nodes:manage"],
  },
  typeDefs: [typeDefs],
  resolvers: nodesResolvers,
});

onMemberJoined((database, joined) =>
  ensureRoot(nodesMongo(database), joined.accountId),
);
