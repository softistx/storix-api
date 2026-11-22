import { defineModule } from "@softistx/alxia-modules";
import type { HandoverListener, JoinListener } from "@/core/members";
import { nodesListingCollation } from "./migrations/2026-11-15-nodes-listing-collation.migration";
import { nodesTrashIndexes } from "./migrations/2026-11-21-nodes-trash-indexes.migration";
import { nodes, nodesMongo } from "./models";
import { nodes as codes } from "./nodes.errors";
import typeDefs from "./nodes.graphqls" with { type: "text" };
import { nodesResolvers } from "./nodes.resolver";
import { ensureRoot, transferTree } from "./services";

// The tree of a workspace's folders, in its own database. Owns `nodes:read` and
// `nodes:manage`, which every role holds: each member has a private root, and an
// admin does not browse another member's files (plan §3.6). A member gets their
// root ("My files") when they join (`nodesOnJoin`).
export const nodesModule = defineModule({
  name: "nodes",
  dependsOn: ["members", "workspaces", "audit"],
  collections: { nodes },
  migrations: [nodesListingCollation, nodesTrashIndexes],
  codes,
  permissions: ["nodes:read", "nodes:manage"],
  defaultGrants: {
    ADMIN: ["nodes:read", "nodes:manage"],
    MEMBER: ["nodes:read", "nodes:manage"],
  },
  typeDefs: [typeDefs],
  resolvers: nodesResolvers,
});

// What a member who joins gets in the workspace's database: their root folder.
// The app's wiring (src/config/wiring.ts) hands it to the members kernel.
export const nodesOnJoin: JoinListener = (database, joined) =>
  ensureRoot(nodesMongo(database), joined.accountId);

// A member removed with a receiver (`removeMember(transferTo:)`) hands their
// whole tree to that member. Without one the files stay with the leaver's
// account, out of everyone's reach until a rejoin.
export const nodesOnHandover: HandoverListener = (scope, handover) =>
  transferTree(nodesMongo(scope.mongo), {
    fromAccountId: handover.from.accountId,
    toAccountId: handover.to.accountId,
    name: handover.from.name,
  });
