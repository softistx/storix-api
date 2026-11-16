import { defineModule } from "@alxia/modules";
import { onMemberHandover, onMemberJoined } from "@/core/members";
import { nodes as codes } from "@/i18n/codes";
import { nodesListingCollation } from "./migrations/2026-11-15-nodes-listing-collation.migration";
import { nodesTrashIndexes } from "./migrations/2026-11-21-nodes-trash-indexes.migration";
import { nodes } from "./nodes.collection";
import typeDefs from "./nodes.graphqls" with { type: "text" };
import { nodesMongo } from "./nodes.handle";
import { nodesResolvers } from "./nodes.resolver";
import { ensureRoot } from "./nodes.service";
import { transferTree } from "./nodes.transfer";

// The tree of a workspace's folders, in its own database. Owns `nodes:read` and
// `nodes:manage`, which every role holds: each member has a private root, and an
// admin does not browse another member's files (plan §3.6). A member gets their
// root ("My files") when they join (`onMemberJoined`).
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

onMemberJoined((database, joined) =>
  ensureRoot(nodesMongo(database), joined.accountId),
);

// A member removed with a receiver (`removeMember(transferTo:)`) hands their
// whole tree to that member. Without one the files stay with the leaver's
// account, out of everyone's reach until a rejoin.
onMemberHandover((scope, handover) =>
  transferTree(nodesMongo(scope.mongo), {
    fromAccountId: handover.from.accountId,
    toAccountId: handover.to.accountId,
    name: handover.from.name,
  }),
);
